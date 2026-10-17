/**
 * Rebuild every derived table from the source tables. Runs inside the import
 * transaction, so readers see either the old or the new state — never a mix.
 *
 * Nothing here invents a relationship: NDC→HCPCS comes only from CMS crosswalk
 * rows, drug→HCPCS is aggregated from those NDC-level rows (labeled DERIVED),
 * and biosimilar→reference comes only from FDA Purple Book BLA numbers.
 */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import manualFile from "../../data/manual-relationships.json";
import { todayUs } from "@/lib/dates";
import * as t from "@/lib/db/schema";
import { isDrugCode } from "@/lib/hcpcs";
import { displayCase, indexTokens, normalizeText, slugify, uniq } from "@/lib/text";
import { insertBatches, type Tx } from "./batch";

export interface DeriveReport {
  hcpcsCodes: number;
  hcpcsHistoryRows: number;
  manufacturers: number;
  drugs: number;
  aliases: number;
  relationships: Record<string, number>;
  searchDocuments: number;
  searchTerms: number;
  latestCrosswalkPeriod: string | null;
  latestPaymentPeriod: string | null;
  warnings: string[];
  ms: number;
}

type Snapshot = typeof t.hcpcsSnapshots.$inferSelect;
type ProductRow = typeof t.ndcProducts.$inferSelect;

const LEGAL_SUFFIXES = new Set([
  "inc",
  "incorporated",
  "llc",
  "ltd",
  "limited",
  "corp",
  "corporation",
  "co",
  "company",
  "plc",
  "lp",
  "llp",
  "gmbh",
  "ag",
  "sa",
  "spa",
  "bv",
  "nv",
  "pte",
  "pvt",
  "private",
]);

export function manufacturerKey(name: string): string {
  const tokens = normalizeText(name).split(" ").filter(Boolean);
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(" ");
}

function mostFrequent(values: (string | null | undefined)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [v, c] of counts) {
    if (c > n || (c === n && best !== null && v < best)) {
      best = v;
      n = c;
    }
  }
  return best;
}

function capitalizeFirst(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function uniqueSlug(base: string, used: Set<string>): string {
  const root = base || "item";
  let slug = root;
  let n = 2;
  while (used.has(slug)) slug = `${root}-${n++}`;
  used.add(slug);
  return slug;
}

export type ProductClass =
  | "brand"
  | "generic"
  | "authorized_generic"
  | "unbranded_nda"
  | "biologic"
  | "biosimilar"
  | "interchangeable_biosimilar"
  | "unapproved"
  | "eua"
  | "other";

export function deriveProductClass(input: { categories: string[]; hasBrand: boolean; purpleBookTypes: string[] }): ProductClass {
  const cats = new Set(input.categories.map((c) => c.toUpperCase()));
  const pb = input.purpleBookTypes.map((x) => x.toLowerCase());
  if (pb.some((x) => x.includes("interchangeable"))) return "interchangeable_biosimilar";
  if (pb.some((x) => x.includes("351(k)"))) return "biosimilar";
  if (cats.has("BLA")) return "biologic";
  if (cats.has("NDA") && input.hasBrand) return "brand";
  if (cats.has("NDA AUTHORIZED GENERIC")) return "authorized_generic";
  if (cats.has("ANDA")) return "generic";
  if (cats.has("NDA")) return "unbranded_nda";
  if ([...cats].some((c) => c.startsWith("UNAPPROVED"))) return "unapproved";
  if (cats.has("EMERGENCY USE AUTHORIZATION")) return "eua";
  return "other";
}

const manualEntrySchema = z.object({
  kind: z.enum(["NDC_HCPCS", "DRUG_HCPCS"]),
  ndc11: z.string().regex(/^\d{11}$/).optional(),
  drugSlug: z.string().optional(),
  hcpcsCode: z.string().regex(/^[A-Z]\d{4}$/),
  effectiveStart: z.string().optional(),
  effectiveEnd: z.string().optional(),
  evidenceUrl: z.string().url(),
  reviewer: z.string().min(2),
  reviewedAt: z.string(),
  notes: z.string().min(10),
});

async function loadCurrentCrosswalk(tx: Tx) {
  return tx
    .select({
      period: t.ndcHcpcsCrosswalk.period,
      type: t.ndcHcpcsCrosswalk.crosswalkType,
      hcpcsCode: t.ndcHcpcsCrosswalk.hcpcsCode,
      nocGenericName: t.ndcHcpcsCrosswalk.nocGenericName,
      labelerName: t.ndcHcpcsCrosswalk.labelerName,
      ndc11: t.ndcHcpcsCrosswalk.ndc11,
      drugName: t.ndcHcpcsCrosswalk.drugName,
      billUnitsPerPackage: t.ndcHcpcsCrosswalk.billUnitsPerPackage,
      releaseId: t.ndcHcpcsCrosswalk.sourceReleaseId,
      effectiveStart: t.ndcHcpcsCrosswalk.effectiveStart,
      effectiveEnd: t.ndcHcpcsCrosswalk.effectiveEnd,
    })
    .from(t.ndcHcpcsCrosswalk)
    .innerJoin(t.sourceReleases, and(eq(t.sourceReleases.id, t.ndcHcpcsCrosswalk.sourceReleaseId), eq(t.sourceReleases.isCurrent, true)));
}

/* ------------------------------------------------------------------ */
/* HCPCS current table and history                                     */
/* ------------------------------------------------------------------ */

interface HistoryRow {
  code: string;
  period: string;
  sourceReleaseId: number;
  changeType: string;
  actionCode: string | null;
  shortDescription: string | null;
  longDescription: string | null;
  addedDate: string | null;
  actionEffectiveDate: string | null;
  terminationDate: string | null;
  previous: Record<string, unknown> | null;
}

export function buildHcpcsHistory(byCode: Map<string, Snapshot[]>, periods: string[]): HistoryRow[] {
  const out: HistoryRow[] = [];
  const earliest = periods[0];
  for (const [code, snaps] of byCode) {
    const ordered = [...snaps].sort((a, b) => a.period.localeCompare(b.period));
    let prev: Snapshot | null = null;
    let removalRecorded = false;
    for (const period of periods) {
      const s = ordered.find((x) => x.period === period);
      if (!s) {
        if (prev && period > prev.period && !removalRecorded) {
          removalRecorded = true;
          out.push({
            code,
            period,
            sourceReleaseId: prev.sourceReleaseId,
            changeType: "removed_from_file",
            actionCode: null,
            shortDescription: prev.shortDescription,
            longDescription: prev.longDescription,
            addedDate: prev.addedDate,
            actionEffectiveDate: prev.actionEffectiveDate,
            terminationDate: prev.terminationDate,
            previous: null,
          });
        }
        continue;
      }
      const base = {
        code,
        period,
        sourceReleaseId: s.sourceReleaseId,
        actionCode: s.actionCode,
        shortDescription: s.shortDescription,
        longDescription: s.longDescription,
        addedDate: s.addedDate,
        actionEffectiveDate: s.actionEffectiveDate,
        terminationDate: s.terminationDate,
      };
      if (!prev) {
        out.push({ ...base, changeType: period === earliest ? "baseline" : "added", previous: null });
      } else {
        if (prev.longDescription !== s.longDescription || prev.shortDescription !== s.shortDescription) {
          out.push({
            ...base,
            changeType: "descriptor_changed",
            previous: { longDescription: prev.longDescription, shortDescription: prev.shortDescription },
          });
        }
        if (!prev.terminationDate && s.terminationDate) {
          out.push({ ...base, changeType: "terminated", previous: { terminationDate: null } });
        } else if (prev.terminationDate && !s.terminationDate) {
          out.push({ ...base, changeType: "reactivated", previous: { terminationDate: prev.terminationDate } });
        } else if (
          prev.terminationDate !== s.terminationDate ||
          prev.addedDate !== s.addedDate ||
          prev.actionEffectiveDate !== s.actionEffectiveDate
        ) {
          out.push({
            ...base,
            changeType: "dates_changed",
            previous: { terminationDate: prev.terminationDate, addedDate: prev.addedDate, actionEffectiveDate: prev.actionEffectiveDate },
          });
        }
      }
      prev = s;
    }
  }
  return out;
}

async function rebuildHcpcs(tx: Tx, drugFileCodes: Set<string>) {
  const snaps = await tx
    .select({ s: t.hcpcsSnapshots })
    .from(t.hcpcsSnapshots)
    .innerJoin(t.sourceReleases, and(eq(t.sourceReleases.id, t.hcpcsSnapshots.sourceReleaseId), eq(t.sourceReleases.isCurrent, true)));
  const byCode = new Map<string, Snapshot[]>();
  const periodSet = new Set<string>();
  for (const { s } of snaps) {
    periodSet.add(s.period);
    const list = byCode.get(s.code);
    if (list) list.push(s);
    else byCode.set(s.code, [s]);
  }
  const periods = [...periodSet].sort();
  const latest = periods.at(-1) ?? null;

  const current = [...byCode.entries()].map(([code, list]) => {
    const ordered = [...list].sort((a, b) => a.period.localeCompare(b.period));
    const s = ordered[ordered.length - 1];
    return {
      code,
      family: code.charAt(0),
      shortDescription: s.shortDescription,
      longDescription: s.longDescription,
      pricingIndicators: s.pricingIndicators,
      multiplePricingIndicator: s.multiplePricingIndicator,
      coverageCode: s.coverageCode,
      betos: s.betos,
      typeOfService: s.typeOfService,
      crossReferences: s.crossReferences,
      processingNote: s.processingNote,
      addedDate: s.addedDate,
      actionEffectiveDate: s.actionEffectiveDate,
      terminationDate: s.terminationDate,
      actionCode: s.actionCode,
      isNoc: s.isNoc,
      isDrug: isDrugCode({ pricingIndicators: s.pricingIndicators, betos: s.betos, inCmsDrugFile: drugFileCodes.has(code) }),
      firstSeenPeriod: ordered[0].period,
      lastSeenPeriod: s.period,
      droppedFromFile: latest !== null && s.period < latest,
      sourceReleaseId: s.sourceReleaseId,
    };
  });

  const history = buildHcpcsHistory(byCode, periods);
  await tx.delete(t.hcpcsCodeHistory);
  await tx.delete(t.hcpcsCodes);
  await insertBatches(tx, t.hcpcsCodes, current, 22);
  await insertBatches(tx, t.hcpcsCodeHistory, history, 12);
  return { current, historyCount: history.length };
}

/* ------------------------------------------------------------------ */
/* Main entry                                                          */
/* ------------------------------------------------------------------ */

export async function deriveAll(tx: Tx, log: (msg: string) => void = () => {}): Promise<DeriveReport> {
  const started = Date.now();
  const warnings: string[] = [];
  const today = todayUs();

  // --- Source data -----------------------------------------------------
  const crosswalk = await loadCurrentCrosswalk(tx);
  const payments = await tx
    .select({ code: t.paymentLimits.hcpcsCode, period: t.paymentLimits.period, limit: t.paymentLimits.paymentLimit, text: t.paymentLimits.paymentLimitText })
    .from(t.paymentLimits)
    .innerJoin(t.sourceReleases, and(eq(t.sourceReleases.id, t.paymentLimits.sourceReleaseId), eq(t.sourceReleases.isCurrent, true)));
  const latestPaymentPeriod = payments.reduce<string | null>((m, p) => (m === null || p.period > m ? p.period : m), null);
  const latestCrosswalkPeriod = crosswalk.reduce<string | null>((m, r) => (m === null || r.period > m ? r.period : m), null);
  const paidNow = new Set(payments.filter((p) => p.period === latestPaymentPeriod && (p.limit !== null || p.text)).map((p) => p.code));
  const drugFileCodes = new Set<string>([...payments.map((p) => p.code), ...crosswalk.map((r) => r.hcpcsCode).filter((c): c is string => !!c)]);

  log("derive: HCPCS current table and history");
  const hcpcs = await rebuildHcpcs(tx, drugFileCodes);
  const hcpcsByCode = new Map(hcpcs.current.map((c) => [c.code, c]));

  const products: ProductRow[] = await tx.select().from(t.ndcProducts);
  const packages = await tx
    .select({ ndc11: t.ndcPackages.ndc11, productId: t.ndcPackages.productId, listingStatus: t.ndcPackages.listingStatus })
    .from(t.ndcPackages);
  const purple = await tx.select().from(t.biologicProducts);

  const packagesByProduct = new Map<string, string[]>();
  for (const p of packages) {
    const list = packagesByProduct.get(p.productId);
    if (list) list.push(p.ndc11);
    else packagesByProduct.set(p.productId, [p.ndc11]);
  }
  const crosswalkByNdc = new Map<string, typeof crosswalk>();
  for (const row of crosswalk) {
    if (!row.ndc11) continue;
    const list = crosswalkByNdc.get(row.ndc11);
    if (list) list.push(row);
    else crosswalkByNdc.set(row.ndc11, [row]);
  }

  // --- Manufacturers ---------------------------------------------------
  log("derive: manufacturers");
  const mfrGroups = new Map<string, ProductRow[]>();
  for (const p of products) {
    if (!p.labelerName) continue;
    const key = manufacturerKey(p.labelerName);
    if (!key) continue;
    const list = mfrGroups.get(key);
    if (list) list.push(p);
    else mfrGroups.set(key, [p]);
  }
  const usedMfrSlugs = new Set<string>();
  const mfrRows = [...mfrGroups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([nameKey, list]) => {
      const name = mostFrequent(list.map((p) => p.labelerName))!;
      const listed = list.filter((p) => p.listingStatus === "listed");
      return {
        slug: uniqueSlug(slugify(name), usedMfrSlugs),
        name,
        nameKey,
        labelerCodes: uniq(list.map((p) => p.productNdc.split("-")[0].padStart(5, "0"))).sort(),
        altNames: uniq(list.map((p) => p.labelerName!)).filter((n) => n !== name).sort(),
        productCount: list.length,
        activeProductCount: listed.filter((p) => !p.marketingEnd || p.marketingEnd >= today).length,
        hcpcsCodes: [] as string[],
      };
    });
  await tx.delete(t.manufacturers);
  const insertedMfrs: { id: number; nameKey: string; labelerCodes: string[]; slug: string; name: string }[] = [];
  for (let i = 0; i < mfrRows.length; i += 1000) {
    insertedMfrs.push(
      ...(await tx
        .insert(t.manufacturers)
        .values(mfrRows.slice(i, i + 1000))
        .returning({ id: t.manufacturers.id, nameKey: t.manufacturers.nameKey, labelerCodes: t.manufacturers.labelerCodes, slug: t.manufacturers.slug, name: t.manufacturers.name })),
    );
  }
  const mfrByKey = new Map(insertedMfrs.map((m) => [m.nameKey, m]));
  const mfrById = new Map(insertedMfrs.map((m) => [m.id, m]));
  const mfrRowByKey = new Map(mfrRows.map((r) => [r.nameKey, r]));
  const mfrByLabeler = new Map<string, (typeof insertedMfrs)[number]>();
  for (const m of insertedMfrs) for (const code of m.labelerCodes) if (!mfrByLabeler.has(code)) mfrByLabeler.set(code, m);

  // --- Purple Book indexes ----------------------------------------------
  const pbByBla = new Map<string, typeof purple>();
  for (const row of purple) {
    const list = pbByBla.get(row.blaNumber);
    if (list) list.push(row);
    else pbByBla.set(row.blaNumber, [row]);
  }
  const referencedPairs = new Set(
    purple.filter((r) => r.licenseType?.startsWith("351(k)") && r.refProperName).map((r) => `${normalizeText(r.refProperName)}|${normalizeText(r.refProprietaryName)}`),
  );
  const referencedProper = new Set(purple.filter((r) => r.licenseType?.startsWith("351(k)") && r.refProperName).map((r) => normalizeText(r.refProperName)));
  const blaOf = (app: string | null) => (app && /^BLA\d+$/i.test(app) ? app.replace(/^BLA/i, "") : null);

  // --- Drugs -----------------------------------------------------------
  log("derive: drugs");
  const groups = new Map<string, ProductRow[]>();
  const orphanBrands: ProductRow[] = [];
  for (const p of products) {
    const brand = normalizeText([p.proprietaryName, p.proprietaryNameSuffix].filter(Boolean).join(" "));
    const generic = normalizeText(p.nonproprietaryName);
    if (!brand && !generic) continue;
    if (!generic) {
      orphanBrands.push(p);
      continue;
    }
    const key = `${brand}|${generic}`;
    const list = groups.get(key);
    if (list) list.push(p);
    else groups.set(key, [p]);
  }
  // Excluded listings often lack a nonproprietary name: attach to the single drug with the same brand, if any.
  for (const p of orphanBrands) {
    const brand = normalizeText([p.proprietaryName, p.proprietaryNameSuffix].filter(Boolean).join(" "));
    const matches = [...groups.keys()].filter((k) => k.startsWith(`${brand}|`));
    const key = matches.length === 1 ? matches[0] : `${brand}|`;
    const list = groups.get(key);
    if (list) list.push(p);
    else groups.set(key, [p]);
  }

  const usedDrugSlugs = new Set<string>();
  interface DrugBuild {
    key: string;
    row: typeof t.drugs.$inferInsert;
    products: ProductRow[];
    ndcs: string[];
    bla: string[];
    refPairs: { proper: string; proprietary: string }[];
  }
  const builds: DrugBuild[] = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, list]) => {
      const brandText = mostFrequent(list.map((p) => [p.proprietaryName, p.proprietaryNameSuffix].filter(Boolean).join(" ") || null));
      const genericText = mostFrequent(list.map((p) => p.nonproprietaryName));
      const [brandKey, genericKey] = key.split("|");
      const brandName = brandText && brandKey !== genericKey ? brandText : null;
      const displayName = brandName ? displayCase(brandName) : capitalizeFirst(genericText ?? brandText ?? key);
      const slugBase = brandName ? slugify(`${brandName} ${genericText ?? ""}`) : slugify(genericText ?? brandText ?? key);
      const bla = uniq(list.map((p) => blaOf(p.applicationNumber)).filter((b): b is string => !!b));
      const pbRows = bla.flatMap((b) => pbByBla.get(b) ?? []);
      const pbTypes = uniq(pbRows.map((r) => r.licenseType ?? "").filter(Boolean));
      const productClass = deriveProductClass({
        categories: list.map((p) => p.marketingCategory ?? "").filter(Boolean),
        hasBrand: !!brandName,
        purpleBookTypes: pbTypes,
      });
      let biosimilarStatus: string | null = null;
      if (productClass === "interchangeable_biosimilar") biosimilarStatus = "interchangeable";
      else if (productClass === "biosimilar") biosimilarStatus = "biosimilar";
      else if (
        pbRows.some(
          (r) =>
            r.licenseType === "351(a)" &&
            (referencedPairs.has(`${normalizeText(r.properName)}|${normalizeText(r.proprietaryName)}`) || referencedProper.has(normalizeText(r.properName))),
        )
      )
        biosimilarStatus = "reference";

      const ndcs = uniq(list.flatMap((p) => packagesByProduct.get(p.productId) ?? []));
      const codes = uniq(ndcs.flatMap((n) => (crosswalkByNdc.get(n) ?? []).map((r) => r.hcpcsCode).filter((c): c is string => !!c))).sort();
      const listed = list.filter((p) => p.listingStatus === "listed");
      const openEnded = listed.some((p) => !p.marketingEnd);
      const activeUntil = listed.length && !openEnded ? listed.map((p) => p.marketingEnd!).sort().at(-1)! : null;
      const mfrIds = uniq(
        list
          .map((p) => (p.labelerName ? mfrByKey.get(manufacturerKey(p.labelerName))?.id : undefined))
          .filter((id): id is number => typeof id === "number"),
      );
      return {
        key,
        products: list,
        ndcs,
        bla,
        refPairs: pbRows
          .filter((r) => r.licenseType?.startsWith("351(k)") && r.refProperName)
          .map((r) => ({ proper: normalizeText(r.refProperName), proprietary: normalizeText(r.refProprietaryName) })),
        row: {
          slug: uniqueSlug(slugBase, usedDrugSlugs),
          displayName,
          brandName,
          genericName: genericText,
          productClass,
          isBrand: !!brandName,
          biosimilarStatus,
          referenceDrugId: null,
          activeIngredients: uniq(list.flatMap((p) => p.substances.map((s) => s.toLowerCase()))).sort(),
          dosageForms: uniq(list.map((p) => p.dosageForm ?? "").filter(Boolean)).sort(),
          routes: uniq(list.flatMap((p) => p.routes)).sort(),
          strengths: uniq(list.flatMap((p) => p.strengths)).sort(),
          marketingCategories: uniq(list.map((p) => p.marketingCategory ?? "").filter(Boolean)).sort(),
          applicationNumbers: uniq(list.map((p) => p.applicationNumber ?? "").filter(Boolean)).sort(),
          pharmClasses: uniq(list.flatMap((p) => p.pharmClasses)).sort(),
          manufacturerIds: mfrIds,
          hcpcsCodes: codes,
          hasPayment: codes.some((c) => paidNow.has(c)),
          isListed: listed.length > 0,
          activeUntil,
          productCount: list.length,
          packageCount: ndcs.length,
          earliestMarketingStart: list.map((p) => p.marketingStart).filter((d): d is string => !!d).sort()[0] ?? null,
        },
      };
    });

  await tx.delete(t.drugAliases);
  await tx.delete(t.drugs);
  const insertedDrugs: { id: number; slug: string }[] = [];
  for (let i = 0; i < builds.length; i += 500) {
    insertedDrugs.push(
      ...(await tx
        .insert(t.drugs)
        .values(builds.slice(i, i + 500).map((b) => b.row))
        .returning({ id: t.drugs.id, slug: t.drugs.slug })),
    );
  }
  const drugIdBySlug = new Map(insertedDrugs.map((d) => [d.slug, d.id]));
  const drugBuildById = new Map<number, DrugBuild>();
  for (const b of builds) drugBuildById.set(drugIdBySlug.get(b.row.slug!)!, b);

  // Biosimilar → reference product, via BLA numbers only.
  const drugIdsByBla = new Map<string, number[]>();
  for (const [id, b] of drugBuildById) for (const bla of b.bla) drugIdsByBla.set(bla, [...(drugIdsByBla.get(bla) ?? []), id]);
  const biosimilarLinks: { drugId: number; refId: number; evidence: Record<string, unknown> }[] = [];
  for (const [id, b] of drugBuildById) {
    if (!b.refPairs.length) continue;
    const pair = b.refPairs[0];
    const refBlaRows = purple.filter(
      (r) => r.licenseType === "351(a)" && normalizeText(r.properName) === pair.proper && (!pair.proprietary || normalizeText(r.proprietaryName) === pair.proprietary),
    );
    const refBlas = uniq(refBlaRows.map((r) => r.blaNumber));
    const candidates = uniq(refBlas.flatMap((bla) => drugIdsByBla.get(bla) ?? [])).filter((c) => c !== id);
    if (candidates.length === 0) continue;
    const preferred =
      candidates.find((c) => normalizeText(drugBuildById.get(c)!.row.brandName) === pair.proprietary) ??
      candidates.sort((a, c) => (drugBuildById.get(c)!.row.packageCount ?? 0) - (drugBuildById.get(a)!.row.packageCount ?? 0))[0];
    biosimilarLinks.push({
      drugId: id,
      refId: preferred,
      evidence: {
        blaNumbers: b.bla,
        licenseTypes: uniq(b.bla.flatMap((bla) => (pbByBla.get(bla) ?? []).map((r) => r.licenseType))),
        referenceProperName: refBlaRows[0]?.properName ?? null,
        referenceProprietaryName: refBlaRows[0]?.proprietaryName ?? null,
        referenceBlaNumbers: refBlas,
      },
    });
  }
  for (const link of biosimilarLinks) {
    await tx.update(t.drugs).set({ referenceDrugId: link.refId }).where(eq(t.drugs.id, link.drugId));
  }

  // Product → drug / manufacturer assignment.
  const assignments: { productId: string; drugId: number; manufacturerId: number | null }[] = [];
  for (const [id, b] of drugBuildById) {
    for (const p of b.products) {
      assignments.push({
        productId: p.productId,
        drugId: id,
        manufacturerId: p.labelerName ? (mfrByKey.get(manufacturerKey(p.labelerName))?.id ?? null) : null,
      });
    }
  }
  await tx.update(t.ndcProducts).set({ drugId: null, manufacturerId: null });
  for (let i = 0; i < assignments.length; i += 1000) {
    const part = assignments.slice(i, i + 1000);
    const values = sql.join(
      part.map((a) => sql`(${a.productId}::text, ${a.drugId}::integer, ${a.manufacturerId}::integer)`),
      sql`, `,
    );
    await tx.execute(
      sql`UPDATE ndc_products AS p SET drug_id = v.drug_id, manufacturer_id = v.mfr_id FROM (VALUES ${values}) AS v(product_id, drug_id, mfr_id) WHERE p.product_id = v.product_id`,
    );
  }

  // --- Aliases ---------------------------------------------------------
  log("derive: aliases");
  const aliasRows: (typeof t.drugAliases.$inferInsert)[] = [];
  const aliasesByDrug = new Map<number, typeof aliasRows>();
  for (const [id, b] of drugBuildById) {
    const seen = new Set<string>();
    const add = (alias: string | null | undefined, aliasType: string, sourceKey: string) => {
      const aliasKey = normalizeText(alias);
      if (!alias || !aliasKey || seen.has(aliasKey)) return;
      seen.add(aliasKey);
      const row = { drugId: id, alias, aliasKey, aliasType, sourceKey };
      aliasRows.push(row);
      aliasesByDrug.set(id, [...(aliasesByDrug.get(id) ?? []), row]);
    };
    add(b.row.brandName, "brand", "fda_ndc");
    add(b.row.genericName, "generic", "fda_ndc");
    for (const ing of b.row.activeIngredients ?? []) add(ing, "ingredient", "fda_ndc");
    for (const n of b.ndcs) for (const r of crosswalkByNdc.get(n) ?? []) add(r.drugName, "cms_drug_name", "cms_ndc_hcpcs");
    for (const bla of b.bla) for (const r of pbByBla.get(bla) ?? []) add(r.properName, "purple_book_proper_name", "fda_purple_book");
  }
  await insertBatches(tx, t.drugAliases, aliasRows, 5);

  // --- Relationships -----------------------------------------------------
  log("derive: relationships");
  await tx.delete(t.codeRelationships);
  const rel: (typeof t.codeRelationships.$inferInsert)[] = [];

  // NDC → HCPCS (official CMS crosswalk rows, aggregated across quarters).
  const ndcCode = new Map<string, typeof crosswalk>();
  for (const r of crosswalk) {
    if (!r.ndc11 || !r.hcpcsCode) continue;
    const k = `${r.ndc11}|${r.hcpcsCode}`;
    ndcCode.set(k, [...(ndcCode.get(k) ?? []), r]);
  }
  for (const [k, rows] of ndcCode) {
    const [ndc11, code] = k.split("|");
    const ordered = [...rows].sort((a, b) => a.period.localeCompare(b.period));
    const last = ordered[ordered.length - 1];
    rel.push({
      kind: "NDC_HCPCS",
      ndc11,
      hcpcsCode: code,
      sourceKey: "cms_ndc_hcpcs",
      sourceReleaseId: last.releaseId,
      firstPeriod: ordered[0].period,
      lastPeriod: last.period,
      effectiveStart: ordered[0].effectiveStart,
      effectiveEnd: last.effectiveEnd,
      authority: "OFFICIAL",
      reviewStatus: "NOT_REQUIRED",
      isCurrent: last.period === latestCrosswalkPeriod,
      evidence: {
        crosswalkTypes: uniq(rows.map((r) => r.type)),
        periods: uniq(ordered.map((r) => r.period)),
        billUnitsPerPackage: last.billUnitsPerPackage,
        cmsDrugName: last.drugName,
        cmsLabelerName: last.labelerName,
      },
      notes: null,
    });
  }

  // Drug → HCPCS (derived from the NDC-level rows) and Drug → NOC (2025 CMS NOC crosswalk).
  for (const [id, b] of drugBuildById) {
    const byCode = new Map<string, { ndcs: Set<string>; periods: Set<string>; releaseId: number }>();
    const noc = { ndcs: new Set<string>(), periods: new Set<string>(), names: new Set<string>(), releaseId: 0 };
    for (const n of b.ndcs) {
      for (const r of crosswalkByNdc.get(n) ?? []) {
        if (r.type === "NOC") {
          noc.ndcs.add(n);
          noc.periods.add(r.period);
          if (r.nocGenericName) noc.names.add(r.nocGenericName);
          noc.releaseId = r.releaseId;
          continue;
        }
        if (!r.hcpcsCode) continue;
        const entry = byCode.get(r.hcpcsCode) ?? { ndcs: new Set<string>(), periods: new Set<string>(), releaseId: r.releaseId };
        entry.ndcs.add(n);
        entry.periods.add(r.period);
        if (r.period >= [...entry.periods].sort().at(-1)!) entry.releaseId = r.releaseId;
        byCode.set(r.hcpcsCode, entry);
      }
    }
    for (const [code, e] of byCode) {
      const periods = [...e.periods].sort();
      rel.push({
        kind: "DRUG_HCPCS",
        drugId: id,
        hcpcsCode: code,
        sourceKey: "cms_ndc_hcpcs",
        sourceReleaseId: e.releaseId,
        firstPeriod: periods[0],
        lastPeriod: periods.at(-1)!,
        authority: "DERIVED",
        reviewStatus: "NOT_REQUIRED",
        isCurrent: periods.at(-1) === latestCrosswalkPeriod,
        evidence: { ndcs: [...e.ndcs].sort(), crosswalkedPackages: e.ndcs.size, totalPackages: b.ndcs.length, periods },
        notes: `Derived: ${e.ndcs.size} of ${b.ndcs.length} NDC package(s) for this drug appear in the CMS NDC–HCPCS crosswalk for ${code}.`,
      });
    }
    if (noc.ndcs.size) {
      const periods = [...noc.periods].sort();
      rel.push({
        kind: "DRUG_NOC",
        drugId: id,
        sourceKey: "cms_ndc_hcpcs",
        sourceReleaseId: noc.releaseId,
        firstPeriod: periods[0],
        lastPeriod: periods.at(-1)!,
        authority: "OFFICIAL",
        reviewStatus: "NOT_REQUIRED",
        isCurrent: periods.at(-1) === latestCrosswalkPeriod,
        evidence: { ndcs: [...noc.ndcs].sort(), nocGenericNames: [...noc.names], periods },
        notes: "CMS listed these NDCs in its NOC NDC-HCPCS crosswalk (billed under a not-otherwise-classified code). CMS does not specify which NOC code applies.",
      });
    }
  }

  for (const link of biosimilarLinks) {
    rel.push({
      kind: "BIOSIMILAR_REFERENCE",
      drugId: link.drugId,
      relatedDrugId: link.refId,
      sourceKey: "fda_purple_book",
      authority: "OFFICIAL",
      reviewStatus: "NOT_REQUIRED",
      isCurrent: true,
      evidence: link.evidence,
      notes: "Linked through the BLA number in the FDA NDC Directory and the reference product named in the FDA Purple Book.",
    });
  }

  for (const c of hcpcs.current) {
    for (const x of c.crossReferences) {
      rel.push({
        kind: "HCPCS_CROSS_REFERENCE",
        hcpcsCode: c.code,
        relatedHcpcsCode: x,
        sourceKey: "cms_hcpcs",
        sourceReleaseId: c.sourceReleaseId,
        lastPeriod: c.lastSeenPeriod,
        authority: "OFFICIAL",
        reviewStatus: "NOT_REQUIRED",
        isCurrent: !c.droppedFromFile,
        evidence: { field: "HCPCS cross reference code", actionCode: c.actionCode, terminationDate: c.terminationDate },
        notes: "CMS cross-reference field: a deleted code or a code not valid for Medicare, cross-walked to a valid code or range. Not necessarily a one-to-one replacement.",
      });
    }
  }

  // Manually reviewed relationships (data/manual-relationships.json).
  const manualEntries = Array.isArray((manualFile as { entries?: unknown[] }).entries) ? (manualFile as { entries: unknown[] }).entries : [];
  for (const raw of manualEntries) {
    const parsed = manualEntrySchema.safeParse(raw);
    if (!parsed.success) {
      warnings.push(`Manual relationship rejected: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
      continue;
    }
    const m = parsed.data;
    rel.push({
      kind: m.kind,
      ndc11: m.ndc11 ?? null,
      drugId: m.drugSlug ? (drugIdBySlug.get(m.drugSlug) ?? null) : null,
      hcpcsCode: m.hcpcsCode,
      sourceKey: "manual_review",
      authority: "MANUAL",
      reviewStatus: "APPROVED",
      effectiveStart: m.effectiveStart ?? null,
      effectiveEnd: m.effectiveEnd ?? null,
      isCurrent: true,
      evidence: { evidenceUrl: m.evidenceUrl, reviewer: m.reviewer, reviewedAt: m.reviewedAt },
      notes: m.notes,
    });
  }
  await insertBatches(tx, t.codeRelationships, rel, 19);
  const relCounts: Record<string, number> = {};
  for (const r of rel) relCounts[r.kind] = (relCounts[r.kind] ?? 0) + 1;

  // Manufacturer → HCPCS codes (via crosswalked NDC labeler codes).
  const mfrCodes = new Map<number, Set<string>>();
  for (const r of crosswalk) {
    if (!r.ndc11 || !r.hcpcsCode || r.period !== latestCrosswalkPeriod) continue;
    const m = mfrByLabeler.get(r.ndc11.slice(0, 5));
    if (!m) continue;
    const set = mfrCodes.get(m.id) ?? new Set<string>();
    set.add(r.hcpcsCode);
    mfrCodes.set(m.id, set);
  }
  for (const [id, codes] of mfrCodes) {
    await tx.update(t.manufacturers).set({ hcpcsCodes: [...codes].sort() }).where(eq(t.manufacturers.id, id));
  }

  // --- Search index ----------------------------------------------------
  log("derive: search index");
  await tx.delete(t.searchTerms);
  await tx.delete(t.searchDocuments);

  type DocInsert = typeof t.searchDocuments.$inferInsert;
  const docs: { doc: DocInsert; terms: { term: string; termType: string }[] }[] = [];
  const termSet = () => {
    const seen = new Set<string>();
    const list: { term: string; termType: string }[] = [];
    return {
      list,
      add(term: string | null | undefined, termType: string) {
        const norm = normalizeText(term);
        if (!norm || norm.length > 200) return;
        const k = `${termType}|${norm}`;
        if (seen.has(k)) return;
        seen.add(k);
        list.push({ term: norm, termType });
      },
    };
  };

  // Crosswalk facts per code.
  const codeFacts = new Map<string, { names: Set<string>; mfrs: Map<string, string>; ndcCount: Set<string> }>();
  for (const r of crosswalk) {
    if (!r.hcpcsCode) continue;
    const f = codeFacts.get(r.hcpcsCode) ?? { names: new Set<string>(), mfrs: new Map<string, string>(), ndcCount: new Set<string>() };
    if (r.drugName) f.names.add(r.drugName);
    if (r.ndc11) {
      f.ndcCount.add(r.ndc11);
      const m = mfrByLabeler.get(r.ndc11.slice(0, 5));
      if (m && r.period === latestCrosswalkPeriod) f.mfrs.set(m.slug, m.name);
    }
    codeFacts.set(r.hcpcsCode, f);
  }
  const drugsByCode = new Map<string, number[]>();
  for (const [id, b] of drugBuildById) for (const c of b.row.hcpcsCodes ?? []) drugsByCode.set(c, [...(drugsByCode.get(c) ?? []), id]);

  for (const c of hcpcs.current) {
    const terms = termSet();
    terms.add(c.code, "code");
    terms.add(c.shortDescription, "alias");
    terms.add(c.longDescription, "alias");
    for (const tok of indexTokens(c.longDescription)) terms.add(tok, "descriptor");
    for (const tok of indexTokens(c.shortDescription)) terms.add(tok, "descriptor");
    const facts = codeFacts.get(c.code);
    for (const name of facts?.names ?? []) terms.add(name, "alias");
    const linked = (drugsByCode.get(c.code) ?? []).map((id) => drugBuildById.get(id)!.row);
    const hasPayment = paidNow.has(c.code);
    docs.push({
      doc: {
        kind: "hcpcs",
        key: c.code,
        title: c.code,
        subtitle: c.longDescription,
        family: c.family,
        codes: [c.code],
        // Names and slugs stay index-aligned (both ordered by name) for facet unnesting.
        manufacturerNames: [...(facts?.mfrs.entries() ?? [])].sort((a, b) => a[1].localeCompare(b[1])).map(([, name]) => name),
        manufacturerSlugs: [...(facts?.mfrs.entries() ?? [])].sort((a, b) => a[1].localeCompare(b[1])).map(([slug]) => slug),
        dosageForms: uniq(linked.flatMap((d) => d.dosageForms ?? [])).sort(),
        routes: uniq(linked.flatMap((d) => d.routes ?? [])).sort(),
        productClass: null,
        isBrand: null,
        biosimilarStatus: c.longDescription.toLowerCase().includes("biosimilar") ? "biosimilar" : null,
        hasPayment,
        isNoc: c.isNoc,
        isDrug: c.isDrug,
        isListed: true,
        statusEndDate: c.terminationDate,
        effectiveDate: c.addedDate,
        weight: (c.isDrug ? 2 : 0) + (hasPayment ? 2 : 0) + ((facts?.ndcCount.size ?? 0) > 0 ? 1 : 0) + (c.terminationDate ? 0 : 1),
      },
      terms: terms.list,
    });
  }

  for (const [id, b] of drugBuildById) {
    const d = b.row;
    const terms = termSet();
    if (d.brandName) terms.add(d.brandName, "brand");
    terms.add(d.genericName, "generic");
    for (const ing of d.activeIngredients ?? []) terms.add(ing, "ingredient");
    for (const tok of indexTokens(d.genericName)) terms.add(tok, "ingredient");
    for (const a of aliasesByDrug.get(id) ?? []) {
      if (a.aliasType === "purple_book_proper_name") terms.add(a.alias, "generic");
      else if (a.aliasType === "cms_drug_name") terms.add(a.alias, "alias");
    }
    const mfrs = (d.manufacturerIds ?? [])
      .map((mid) => mfrById.get(mid))
      .filter((m): m is (typeof insertedMfrs)[number] => !!m)
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const m of mfrs) terms.add(m.nameKey, "manufacturer");
    if (d.biosimilarStatus === "biosimilar" || d.biosimilarStatus === "interchangeable") terms.add("biosimilar", "descriptor");
    if (d.biosimilarStatus === "interchangeable") terms.add("interchangeable", "descriptor");
    const active = d.isListed && (!d.activeUntil || d.activeUntil >= today);
    docs.push({
      doc: {
        kind: "drug",
        key: d.slug!,
        title: d.displayName!,
        subtitle: [d.brandName ? d.genericName : null, (d.dosageForms ?? []).slice(0, 2).join(" · ")].filter(Boolean).join(" — ") || null,
        family: null,
        codes: d.hcpcsCodes ?? [],
        manufacturerNames: mfrs.map((m) => m.name),
        manufacturerSlugs: mfrs.map((m) => m.slug),
        dosageForms: d.dosageForms ?? [],
        routes: d.routes ?? [],
        productClass: d.productClass,
        isBrand: d.isBrand ?? false,
        biosimilarStatus: d.biosimilarStatus ?? null,
        hasPayment: d.hasPayment ?? false,
        isNoc: false,
        isDrug: true,
        isListed: d.isListed ?? true,
        statusEndDate: d.isListed ? (d.activeUntil ?? null) : (d.activeUntil ?? today),
        effectiveDate: d.earliestMarketingStart ?? null,
        // +1 so a drug edges out its own HCPCS code when both match a name query equally.
        weight: 1 + (d.hasPayment ? 2 : 0) + ((d.hcpcsCodes ?? []).length ? 2 : 0) + Math.log10((d.packageCount ?? 0) + 1) + (active ? 1 : 0),
      },
      terms: terms.list,
    });
  }

  for (const m of insertedMfrs) {
    const row = mfrRowByKey.get(m.nameKey)!;
    const terms = termSet();
    terms.add(m.nameKey, "manufacturer_name");
    terms.add(m.name, "manufacturer_name");
    for (const alt of row.altNames) terms.add(alt, "manufacturer_name");
    for (const code of m.labelerCodes) terms.add(code, "code");
    docs.push({
      doc: {
        kind: "manufacturer",
        key: m.slug,
        title: m.name,
        subtitle: `${row.productCount} product${row.productCount === 1 ? "" : "s"} in index · labeler code${m.labelerCodes.length === 1 ? "" : "s"} ${m.labelerCodes.join(", ")}`,
        family: null,
        codes: mfrCodes.has(m.id) ? [...mfrCodes.get(m.id)!].sort() : [],
        manufacturerNames: [m.name],
        manufacturerSlugs: [m.slug],
        hasPayment: false,
        isNoc: false,
        isDrug: false,
        isListed: row.activeProductCount > 0,
        statusEndDate: null,
        effectiveDate: null,
        weight: Math.log10(row.productCount + 1),
      },
      terms: terms.list,
    });
  }

  let termCount = 0;
  for (let i = 0; i < docs.length; i += 500) {
    const part = docs.slice(i, i + 500);
    const ids = await tx.insert(t.searchDocuments).values(part.map((p) => p.doc)).returning({ id: t.searchDocuments.id });
    const termRows = part.flatMap((p, j) => p.terms.map((term) => ({ docId: ids[j].id, term: term.term, termType: term.termType })));
    termCount += await insertBatches(tx, t.searchTerms, termRows, 3);
  }

  const knownNdcs = new Set(packages.map((p) => p.ndc11));
  const unresolved = new Set<string>();
  for (const r of crosswalk) if (r.ndc11 && r.period === latestCrosswalkPeriod && !knownNdcs.has(r.ndc11)) unresolved.add(r.ndc11);
  if (unresolved.size) warnings.push(`${unresolved.size} NDC(s) in the latest CMS crosswalk have no FDA directory record (listed or excluded).`);
  for (const code of drugFileCodes) if (!hcpcsByCode.has(code)) warnings.push(`CMS drug file code ${code} is not in the ingested HCPCS files.`);

  return {
    hcpcsCodes: hcpcs.current.length,
    hcpcsHistoryRows: hcpcs.historyCount,
    manufacturers: insertedMfrs.length,
    drugs: insertedDrugs.length,
    aliases: aliasRows.length,
    relationships: relCounts,
    searchDocuments: docs.length,
    searchTerms: termCount,
    latestCrosswalkPeriod,
    latestPaymentPeriod,
    warnings: warnings.slice(0, 50),
    ms: Date.now() - started,
  };
}
