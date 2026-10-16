/**
 * Read models for pages and API routes. Every block carries the source releases it
 * came from so the UI can render provenance next to the data.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { parseCmsDosage, parseDescriptorDosage, type ParsedDosage } from "@/lib/billing";
import { getDb, rowsOf, type Database } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { CODE_FAMILIES, familyOf, isCodeActive } from "@/lib/hcpcs";
import { type MueEntry, type MueServiceType } from "@/lib/mue";
import { formatNdc11 } from "@/lib/ndc";
import { MUE_SOURCES, type MueSourceKey } from "@/ingest/sources";
import { loadReleases, toProvenance, type Provenance, type ReleaseRow } from "./provenance";

const today = () => new Date().toISOString().slice(0, 10);

/* ------------------------------------------------------------------ */
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */

export interface PaymentPeriod {
  period: string;
  effectiveStart: string;
  effectiveEnd: string;
  paymentLimit: string | null;
  paymentLimitText: string | null;
  dosageDescriptor: string | null;
  coinsurancePct: string | null;
  vaccineAwpPct: string | null;
  vaccineLimit: string | null;
  bloodAwpPct: string | null;
  bloodLimit: string | null;
  clottingFactor: string | null;
  notes: string | null;
  methodology: string | null;
  aspDataPeriod: string | null;
  releaseId: number;
  revisions: { releaseId: number; paymentLimit: string | null; publicationLabel: string | null; importedAt: string }[];
}

async function paymentHistory(db: Database, codes: string[], releases: Map<number, ReleaseRow>): Promise<Map<string, PaymentPeriod[]>> {
  const out = new Map<string, PaymentPeriod[]>();
  if (!codes.length) return out;
  const rows = await db
    .select()
    .from(t.paymentLimits)
    .where(inArray(t.paymentLimits.hcpcsCode, codes))
    .orderBy(asc(t.paymentLimits.hcpcsCode), desc(t.paymentLimits.period), desc(t.paymentLimits.sourceReleaseId));
  const byCodePeriod = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!releases.has(r.sourceReleaseId)) continue;
    const k = `${r.hcpcsCode}|${r.period}`;
    byCodePeriod.set(k, [...(byCodePeriod.get(k) ?? []), r]);
  }
  for (const [k, list] of byCodePeriod) {
    const [code] = k.split("|");
    const current = list.find((r) => releases.get(r.sourceReleaseId)?.isCurrent) ?? list[0];
    const revisions = list
      .filter((r) => r !== current && Number(r.paymentLimit) !== Number(current.paymentLimit))
      .map((r) => {
        const rel = releases.get(r.sourceReleaseId)!;
        return { releaseId: r.sourceReleaseId, paymentLimit: r.paymentLimit, publicationLabel: rel.publicationLabel, importedAt: rel.importedAt };
      });
    const entry: PaymentPeriod = {
      period: current.period,
      effectiveStart: current.effectiveStart,
      effectiveEnd: current.effectiveEnd,
      paymentLimit: current.paymentLimit,
      paymentLimitText: current.paymentLimitText,
      dosageDescriptor: current.dosageDescriptor,
      coinsurancePct: current.coinsurancePct,
      vaccineAwpPct: current.vaccineAwpPct,
      vaccineLimit: current.vaccineLimit,
      bloodAwpPct: current.bloodAwpPct,
      bloodLimit: current.bloodLimit,
      clottingFactor: current.clottingFactor,
      notes: current.notes,
      methodology: current.methodology,
      aspDataPeriod: current.aspDataPeriod,
      releaseId: current.sourceReleaseId,
      revisions,
    };
    out.set(code, [...(out.get(code) ?? []), entry].sort((a, b) => b.period.localeCompare(a.period)));
  }
  return out;
}

/** Published MUE values for the newest current quarter of each MUE table. */
export async function mueFor(db: Database, codes: string[], latest: Map<string, ReleaseRow>): Promise<Map<string, MueEntry[]>> {
  const out = new Map<string, MueEntry[]>();
  const releaseIds = (Object.keys(MUE_SOURCES) as MueSourceKey[]).map((k) => latest.get(k)?.id).filter((id): id is number => typeof id === "number");
  if (!codes.length || !releaseIds.length) return out;
  const rows = await db
    .select()
    .from(t.mueValues)
    .where(and(inArray(t.mueValues.hcpcsCode, codes), inArray(t.mueValues.sourceReleaseId, releaseIds)));
  const order: MueServiceType[] = ["practitioner", "outpatient_hospital", "dme_supplier"];
  for (const r of rows) {
    const entry: MueEntry = {
      serviceType: r.serviceType as MueServiceType,
      value: r.mueValue,
      adjudicationIndicator: r.adjudicationIndicator,
      adjudicationText: r.adjudicationText,
      rationale: r.rationale,
      period: r.period,
      releaseId: r.sourceReleaseId,
    };
    out.set(r.hcpcsCode, [...(out.get(r.hcpcsCode) ?? []), entry].sort((a, b) => order.indexOf(a.serviceType) - order.indexOf(b.serviceType)));
  }
  return out;
}

export function mueReleases(latest: Map<string, ReleaseRow>): Provenance[] {
  return (Object.keys(MUE_SOURCES) as MueSourceKey[]).map((k) => latest.get(k)).filter((r): r is ReleaseRow => !!r).map((r) => toProvenance(r));
}

export interface CrosswalkEntry {
  ndcRaw: string;
  ndc11: string | null;
  ndcFormatted: string;
  hcpcsCode: string | null;
  nocGenericName: string | null;
  labelerName: string | null;
  drugName: string | null;
  hcpcsDosage: string | null;
  packageSize: string | null;
  packageQuantity: string | null;
  billUnitsPerItem: string | null;
  billUnitsPerPackage: string | null;
  types: string[];
  periods: string[];
  latestPeriod: string;
  isCurrent: boolean;
  releaseId: number;
  fda: { listingStatus: string; packageDescription: string | null; drugSlug: string | null; drugName: string | null; marketingEnd: string | null } | null;
}

async function crosswalkEntries(db: Database, where: { codes?: string[]; ndc11s?: string[] }, latestPeriod: string | null): Promise<CrosswalkEntry[]> {
  const conds = [];
  if (where.codes?.length) conds.push(inArray(t.ndcHcpcsCrosswalk.hcpcsCode, where.codes));
  if (where.ndc11s?.length) conds.push(inArray(t.ndcHcpcsCrosswalk.ndc11, where.ndc11s));
  if (!conds.length) return [];
  const rows = await db
    .select({ x: t.ndcHcpcsCrosswalk })
    .from(t.ndcHcpcsCrosswalk)
    .innerJoin(t.sourceReleases, and(eq(t.sourceReleases.id, t.ndcHcpcsCrosswalk.sourceReleaseId), eq(t.sourceReleases.isCurrent, true)))
    .where(conds.length === 1 ? conds[0] : and(...conds));
  const groups = new Map<string, (typeof rows)[number]["x"][]>();
  for (const { x } of rows) {
    const k = `${x.hcpcsCode ?? "NOC"}|${x.ndcRaw}`;
    groups.set(k, [...(groups.get(k) ?? []), x]);
  }
  const ndcs = [...new Set(rows.map((r) => r.x.ndc11).filter((n): n is string => !!n))];
  const fdaRows = ndcs.length
    ? await db
        .select({
          ndc11: t.ndcPackages.ndc11,
          listingStatus: t.ndcPackages.listingStatus,
          description: t.ndcPackages.description,
          marketingEnd: t.ndcPackages.marketingEnd,
          drugSlug: t.drugs.slug,
          drugName: t.drugs.displayName,
        })
        .from(t.ndcPackages)
        .innerJoin(t.ndcProducts, eq(t.ndcProducts.productId, t.ndcPackages.productId))
        .leftJoin(t.drugs, eq(t.drugs.id, t.ndcProducts.drugId))
        .where(inArray(t.ndcPackages.ndc11, ndcs))
    : [];
  const fdaByNdc = new Map(fdaRows.map((f) => [f.ndc11, f]));
  return [...groups.values()]
    .map((list) => {
      const ordered = [...list].sort((a, b) => b.period.localeCompare(a.period));
      const latest = ordered[0];
      const fda = latest.ndc11 ? fdaByNdc.get(latest.ndc11) : undefined;
      return {
        ndcRaw: latest.ndcRaw,
        ndc11: latest.ndc11,
        ndcFormatted: latest.ndc11 ? formatNdc11(latest.ndc11) : latest.ndcRaw,
        hcpcsCode: latest.hcpcsCode,
        nocGenericName: latest.nocGenericName,
        labelerName: latest.labelerName,
        drugName: latest.drugName,
        hcpcsDosage: latest.hcpcsDosage,
        packageSize: latest.packageSize,
        packageQuantity: latest.packageQuantity,
        billUnitsPerItem: latest.billUnitsPerItem,
        billUnitsPerPackage: latest.billUnitsPerPackage,
        types: [...new Set(list.filter((x) => x.period === latest.period).map((x) => x.crosswalkType))],
        periods: [...new Set(ordered.map((x) => x.period))].sort(),
        latestPeriod: latest.period,
        isCurrent: latest.period === latestPeriod,
        releaseId: latest.sourceReleaseId,
        fda: fda
          ? { listingStatus: fda.listingStatus, packageDescription: fda.description, drugSlug: fda.drugSlug, drugName: fda.drugName, marketingEnd: fda.marketingEnd }
          : null,
      };
    })
    .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || (a.labelerName ?? "").localeCompare(b.labelerName ?? "") || a.ndcFormatted.localeCompare(b.ndcFormatted));
}

export interface BillingUnitInfo {
  /** Text as published (CMS dosage column) or descriptor-derived. */
  text: string | null;
  parsed: ParsedDosage | null;
  source: "cms_payment_limits" | "hcpcs_descriptor" | null;
  period: string | null;
}

function billingUnit(code: { longDescription: string }, payments: PaymentPeriod[] | undefined): BillingUnitInfo {
  const latest = payments?.[0];
  if (latest?.dosageDescriptor) {
    return { text: latest.dosageDescriptor, parsed: parseCmsDosage(latest.dosageDescriptor), source: "cms_payment_limits", period: latest.period };
  }
  const parsed = parseDescriptorDosage(code.longDescription);
  return { text: parsed ? `${parsed.amount} ${parsed.unit}` : null, parsed, source: parsed ? "hcpcs_descriptor" : null, period: null };
}

/* ------------------------------------------------------------------ */
/* HCPCS                                                               */
/* ------------------------------------------------------------------ */

export async function getHcpcsDetail(code: string, dbArg?: Database) {
  const db = dbArg ?? (await getDb());
  const [row] = await db.select().from(t.hcpcsCodes).where(eq(t.hcpcsCodes.code, code));
  if (!row) return null;
  const { byId, latest } = await loadReleases(db);
  const [history, payments, notPayable, crossRefs, linkedDrugs] = await Promise.all([
    db.select().from(t.hcpcsCodeHistory).where(eq(t.hcpcsCodeHistory.code, code)).orderBy(desc(t.hcpcsCodeHistory.period)),
    paymentHistory(db, [code], byId),
    db
      .select({ np: t.partBNotPayable })
      .from(t.partBNotPayable)
      .innerJoin(t.sourceReleases, and(eq(t.sourceReleases.id, t.partBNotPayable.sourceReleaseId), eq(t.sourceReleases.isCurrent, true)))
      .where(eq(t.partBNotPayable.hcpcsCode, code))
      .orderBy(desc(t.partBNotPayable.period)),
    db
      .select()
      .from(t.codeRelationships)
      .where(and(eq(t.codeRelationships.kind, "HCPCS_CROSS_REFERENCE"), sql`(${t.codeRelationships.hcpcsCode} = ${code} OR ${t.codeRelationships.relatedHcpcsCode} = ${code})`)),
    db
      .select({
        id: t.drugs.id,
        referenceDrugId: t.drugs.referenceDrugId,
        slug: t.drugs.slug,
        displayName: t.drugs.displayName,
        genericName: t.drugs.genericName,
        productClass: t.drugs.productClass,
        biosimilarStatus: t.drugs.biosimilarStatus,
        isListed: t.drugs.isListed,
        activeUntil: t.drugs.activeUntil,
        relationship: t.codeRelationships,
      })
      .from(t.codeRelationships)
      .innerJoin(t.drugs, eq(t.drugs.id, t.codeRelationships.drugId))
      .where(and(eq(t.codeRelationships.kind, "DRUG_HCPCS"), eq(t.codeRelationships.hcpcsCode, code)))
      .orderBy(desc(t.codeRelationships.isCurrent), asc(t.drugs.displayName)),
  ]);
  const latestCrosswalk = latest.get("cms_ndc_hcpcs")?.periodLabel ?? null;
  const [crosswalk, mue] = await Promise.all([crosswalkEntries(db, { codes: [code] }, latestCrosswalk), mueFor(db, [code], latest)]);
  const codeMue = mue.get(code) ?? [];
  const relatedCodes = [...new Set(crossRefs.flatMap((r) => [r.hcpcsCode!, r.relatedHcpcsCode!]).filter((c) => c !== code))];
  const relatedRows = relatedCodes.length
    ? await db
        .select({ code: t.hcpcsCodes.code, longDescription: t.hcpcsCodes.longDescription, terminationDate: t.hcpcsCodes.terminationDate })
        .from(t.hcpcsCodes)
        .where(inArray(t.hcpcsCodes.code, relatedCodes))
    : [];
  // Biosimilar ↔ reference products of the drugs billed with this code (FDA Purple Book links).
  const linkedIds = linkedDrugs.map((d) => d.id);
  const refIds = linkedDrugs.map((d) => d.referenceDrugId).filter((id): id is number => typeof id === "number");
  const relatedBiologics =
    linkedIds.length || refIds.length
      ? await db
          .select({
            id: t.drugs.id,
            slug: t.drugs.slug,
            displayName: t.drugs.displayName,
            genericName: t.drugs.genericName,
            biosimilarStatus: t.drugs.biosimilarStatus,
            hcpcsCodes: t.drugs.hcpcsCodes,
            referenceDrugId: t.drugs.referenceDrugId,
          })
          .from(t.drugs)
          .where(
            sql`(${linkedIds.length ? sql`${t.drugs.referenceDrugId} IN (${sql.join(linkedIds.map((i) => sql`${i}`), sql`, `)})` : sql`FALSE`})
              OR (${refIds.length ? sql`${t.drugs.id} IN (${sql.join(refIds.map((i) => sql`${i}`), sql`, `)})` : sql`FALSE`})`,
          )
          .orderBy(asc(t.drugs.displayName))
      : [];
  const codePayments = payments.get(code) ?? [];
  const provenance: Provenance[] = [];
  const hcpcsRelease = byId.get(row.sourceReleaseId);
  if (hcpcsRelease) provenance.push(toProvenance(hcpcsRelease));
  if (codePayments[0]) provenance.push(toProvenance(byId.get(codePayments[0].releaseId)!));
  const xwRelease = latest.get("cms_ndc_hcpcs");
  if (crosswalk.length && xwRelease) provenance.push(toProvenance(xwRelease));
  const mueProvenance = mueReleases(latest).filter((p) => codeMue.some((m) => m.releaseId === p.releaseId));
  provenance.push(...mueProvenance);

  return {
    code: row,
    mue: codeMue,
    mueReleases: mueReleases(latest),
    family: familyOf(code) ?? null,
    isActive: isCodeActive(row.terminationDate, today()),
    history,
    payments: codePayments,
    latestPaymentPeriod: latest.get("cms_payment_limits")?.periodLabel ?? null,
    notPayable: notPayable.map((n) => n.np),
    billingUnit: billingUnit(row, codePayments),
    crosswalk,
    latestCrosswalkPeriod: latestCrosswalk,
    crossReferences: crossRefs.map((r) => {
      const other = r.hcpcsCode === code ? r.relatedHcpcsCode! : r.hcpcsCode!;
      const info = relatedRows.find((x) => x.code === other);
      return { direction: r.hcpcsCode === code ? ("to" as const) : ("from" as const), code: other, description: info?.longDescription ?? null, terminationDate: info?.terminationDate ?? null, inFile: !!info };
    }),
    linkedDrugs: linkedDrugs.map((d) => ({ ...d, isActive: d.isListed && (!d.activeUntil || d.activeUntil >= today()) })),
    relatedBiologics: relatedBiologics
      .filter((d) => !linkedIds.includes(d.id))
      .map((d) => ({ ...d, relation: refIds.includes(d.id) ? ("reference" as const) : ("biosimilar" as const) })),
    purpleBookRelease: latest.get("fda_purple_book") ? toProvenance(latest.get("fda_purple_book")!) : null,
    releases: { hcpcs: hcpcsRelease ? toProvenance(hcpcsRelease) : null, payment: codePayments[0] ? toProvenance(byId.get(codePayments[0].releaseId)!) : null, crosswalk: xwRelease ? toProvenance(xwRelease) : null },
    provenance,
  };
}

export type HcpcsDetail = NonNullable<Awaited<ReturnType<typeof getHcpcsDetail>>>;

/* ------------------------------------------------------------------ */
/* Drugs                                                               */
/* ------------------------------------------------------------------ */

export async function getDrugDetail(slug: string, dbArg?: Database) {
  const db = dbArg ?? (await getDb());
  const [drug] = await db.select().from(t.drugs).where(eq(t.drugs.slug, slug));
  if (!drug) return null;
  const { byId, latest } = await loadReleases(db);

  const [products, aliases, relationships, biosimilars, reference] = await Promise.all([
    db
      .select({ p: t.ndcProducts, mfrSlug: t.manufacturers.slug, mfrName: t.manufacturers.name })
      .from(t.ndcProducts)
      .leftJoin(t.manufacturers, eq(t.manufacturers.id, t.ndcProducts.manufacturerId))
      .where(eq(t.ndcProducts.drugId, drug.id))
      .orderBy(asc(t.ndcProducts.productNdc)),
    db.select().from(t.drugAliases).where(eq(t.drugAliases.drugId, drug.id)),
    db.select().from(t.codeRelationships).where(eq(t.codeRelationships.drugId, drug.id)),
    db
      .select({ slug: t.drugs.slug, displayName: t.drugs.displayName, genericName: t.drugs.genericName, biosimilarStatus: t.drugs.biosimilarStatus, hcpcsCodes: t.drugs.hcpcsCodes })
      .from(t.drugs)
      .where(eq(t.drugs.referenceDrugId, drug.id))
      .orderBy(asc(t.drugs.displayName)),
    drug.referenceDrugId
      ? db
          .select({ slug: t.drugs.slug, displayName: t.drugs.displayName, genericName: t.drugs.genericName, hcpcsCodes: t.drugs.hcpcsCodes })
          .from(t.drugs)
          .where(eq(t.drugs.id, drug.referenceDrugId))
      : Promise.resolve([]),
  ]);

  const productIds = products.map((p) => p.p.productId);
  const packages = productIds.length
    ? await db.select().from(t.ndcPackages).where(inArray(t.ndcPackages.productId, productIds)).orderBy(asc(t.ndcPackages.ndc11))
    : [];
  const ndc11s = packages.map((k) => k.ndc11);
  const latestCrosswalk = latest.get("cms_ndc_hcpcs")?.periodLabel ?? null;
  const crosswalk = ndc11s.length ? await crosswalkEntries(db, { ndc11s }, latestCrosswalk) : [];
  const codes = drug.hcpcsCodes;
  const codeRows = codes.length ? await db.select().from(t.hcpcsCodes).where(inArray(t.hcpcsCodes.code, codes)) : [];
  const payments = await paymentHistory(db, codes, byId);
  const productById = new Map(products.map((p) => [p.p.productId, p]));
  const [codeHistory, sameCodeDrugs] = codes.length
    ? await Promise.all([
        db.select().from(t.hcpcsCodeHistory).where(inArray(t.hcpcsCodeHistory.code, codes)).orderBy(asc(t.hcpcsCodeHistory.code), desc(t.hcpcsCodeHistory.period)),
        db
          .select({ slug: t.drugs.slug, displayName: t.drugs.displayName, genericName: t.drugs.genericName, hcpcsCodes: t.drugs.hcpcsCodes, productClass: t.drugs.productClass })
          .from(t.drugs)
          .where(and(sql`${t.drugs.hcpcsCodes} && ${sql`ARRAY[${sql.join(codes.map((c) => sql`${c}`), sql`, `)}]::text[]`}`, sql`${t.drugs.id} <> ${drug.id}`))
          .orderBy(asc(t.drugs.displayName))
          .limit(24),
      ])
    : [[], []];

  const fdaRelease = latest.get("fda_ndc");
  const provenance: Provenance[] = [];
  if (fdaRelease) provenance.push(toProvenance(fdaRelease));
  const excludedRelease = latest.get("fda_ndc_excluded");
  if (excludedRelease && products.some((p) => p.p.listingStatus === "excluded")) provenance.push(toProvenance(excludedRelease));
  const xwRelease = latest.get("cms_ndc_hcpcs");
  if (crosswalk.length && xwRelease) provenance.push(toProvenance(xwRelease));
  const payRelease = latest.get("cms_payment_limits");
  if ([...payments.values()].some((p) => p.length) && payRelease) provenance.push(toProvenance(payRelease));
  const hcpcsRelease = latest.get("cms_hcpcs");
  if (codeRows.length && hcpcsRelease) provenance.push(toProvenance(hcpcsRelease));
  const pbRelease = latest.get("fda_purple_book");
  if ((drug.biosimilarStatus || biosimilars.length) && pbRelease) provenance.push(toProvenance(pbRelease));

  return {
    drug,
    isActive: drug.isListed && (!drug.activeUntil || drug.activeUntil >= today()),
    reference: reference[0] ?? null,
    biosimilars,
    aliases,
    products: products.map((p) => ({ ...p.p, manufacturerSlug: p.mfrSlug, manufacturerName: p.mfrName })),
    packages: packages.map((k) => {
      const prod = productById.get(k.productId)?.p;
      return {
        ...k,
        ndcFormatted: formatNdc11(k.ndc11),
        productNdc: prod?.productNdc ?? null,
        strength: prod?.strengths.join("; ") ?? null,
        dosageForm: prod?.dosageForm ?? null,
        routes: prod?.routes ?? [],
        labelerName: prod?.labelerName ?? null,
        isActive: k.listingStatus === "listed" && (!k.marketingEnd || k.marketingEnd >= today()),
        crosswalk: crosswalk.filter((x) => x.ndc11 === k.ndc11),
      };
    }),
    codes: codeRows
      .map((c) => {
        const rel = relationships.find((r) => r.kind === "DRUG_HCPCS" && r.hcpcsCode === c.code);
        const pay = payments.get(c.code) ?? [];
        return {
          ...c,
          family: familyOf(c.code) ?? null,
          isActive: isCodeActive(c.terminationDate, today()),
          relationship: rel ?? null,
          payments: pay,
          billingUnit: billingUnit(c, pay),
        };
      })
      .sort((a, b) => Number(b.relationship?.isCurrent ?? false) - Number(a.relationship?.isCurrent ?? false) || a.code.localeCompare(b.code)),
    codeHistory,
    sameCodeDrugs,
    nocRelationship: relationships.find((r) => r.kind === "DRUG_NOC") ?? null,
    biosimilarRelationship: relationships.find((r) => r.kind === "BIOSIMILAR_REFERENCE") ?? null,
    latestCrosswalkPeriod: latestCrosswalk,
    latestPaymentPeriod: payRelease?.periodLabel ?? null,
    releases: {
      fda: fdaRelease ? toProvenance(fdaRelease) : null,
      fdaExcluded: excludedRelease ? toProvenance(excludedRelease) : null,
      crosswalk: xwRelease ? toProvenance(xwRelease) : null,
      payment: payRelease ? toProvenance(payRelease) : null,
      hcpcs: hcpcsRelease ? toProvenance(hcpcsRelease) : null,
      purpleBook: pbRelease ? toProvenance(pbRelease) : null,
    },
    provenance,
  };
}

export type DrugDetail = NonNullable<Awaited<ReturnType<typeof getDrugDetail>>>;

/* ------------------------------------------------------------------ */
/* NDC                                                                 */
/* ------------------------------------------------------------------ */

export async function getNdcDetail(ndc11: string, dbArg?: Database) {
  const db = dbArg ?? (await getDb());
  const { byId, latest } = await loadReleases(db);
  const fda = await db
    .select({ k: t.ndcPackages, p: t.ndcProducts, drugSlug: t.drugs.slug, drugName: t.drugs.displayName, mfrSlug: t.manufacturers.slug, mfrName: t.manufacturers.name })
    .from(t.ndcPackages)
    .innerJoin(t.ndcProducts, eq(t.ndcProducts.productId, t.ndcPackages.productId))
    .leftJoin(t.drugs, eq(t.drugs.id, t.ndcProducts.drugId))
    .leftJoin(t.manufacturers, eq(t.manufacturers.id, t.ndcProducts.manufacturerId))
    .where(eq(t.ndcPackages.ndc11, ndc11));
  const latestCrosswalk = latest.get("cms_ndc_hcpcs")?.periodLabel ?? null;
  const crosswalk = await crosswalkEntries(db, { ndc11s: [ndc11] }, latestCrosswalk);
  if (!fda.length && !crosswalk.length) return null;
  const codes = [...new Set(crosswalk.map((x) => x.hcpcsCode).filter((c): c is string => !!c))];
  const codeRows = codes.length ? await db.select().from(t.hcpcsCodes).where(inArray(t.hcpcsCodes.code, codes)) : [];
  const payments = await paymentHistory(db, codes, byId);

  const provenance: Provenance[] = [];
  const listing = fda.map((f) => f.k.sourceReleaseId);
  for (const id of new Set(listing)) if (byId.get(id)) provenance.push(toProvenance(byId.get(id)!));
  const xwRelease = latest.get("cms_ndc_hcpcs");
  if (crosswalk.length && xwRelease) provenance.push(toProvenance(xwRelease));
  const payRelease = latest.get("cms_payment_limits");
  if (codes.some((c) => payments.get(c)?.length) && payRelease) provenance.push(toProvenance(payRelease));

  return {
    ndc11,
    formatted: formatNdc11(ndc11),
    fda: fda.map((f) => ({
      package: f.k,
      product: f.p,
      drugSlug: f.drugSlug,
      drugName: f.drugName,
      manufacturerSlug: f.mfrSlug,
      manufacturerName: f.mfrName,
      isActive: f.k.listingStatus === "listed" && (!f.k.marketingEnd || f.k.marketingEnd >= today()),
    })),
    crosswalk,
    codes: codeRows.map((c) => {
      const pay = payments.get(c.code) ?? [];
      const xw = crosswalk.find((x) => x.hcpcsCode === c.code && x.isCurrent) ?? crosswalk.find((x) => x.hcpcsCode === c.code);
      return { ...c, family: familyOf(c.code) ?? null, isActive: isCodeActive(c.terminationDate, today()), payments: pay, billingUnit: billingUnit(c, pay), crosswalk: xw ?? null };
    }),
    latestCrosswalkPeriod: latestCrosswalk,
    releases: {
      fda: latest.get("fda_ndc") ? toProvenance(latest.get("fda_ndc")!) : null,
      fdaExcluded: latest.get("fda_ndc_excluded") ? toProvenance(latest.get("fda_ndc_excluded")!) : null,
      crosswalk: xwRelease ? toProvenance(xwRelease) : null,
      payment: payRelease ? toProvenance(payRelease) : null,
    },
    provenance,
  };
}

export type NdcDetail = NonNullable<Awaited<ReturnType<typeof getNdcDetail>>>;

/* ------------------------------------------------------------------ */
/* Manufacturers                                                       */
/* ------------------------------------------------------------------ */

export async function getManufacturerDetail(idOrSlug: string, dbArg?: Database) {
  const db = dbArg ?? (await getDb());
  const isNumeric = /^\d+$/.test(idOrSlug);
  const [m] = await db
    .select()
    .from(t.manufacturers)
    .where(isNumeric ? eq(t.manufacturers.id, Number(idOrSlug)) : eq(t.manufacturers.slug, idOrSlug));
  if (!m) return null;
  const drugs = await db
    .select({
      slug: t.drugs.slug,
      displayName: t.drugs.displayName,
      genericName: t.drugs.genericName,
      productClass: t.drugs.productClass,
      biosimilarStatus: t.drugs.biosimilarStatus,
      hcpcsCodes: t.drugs.hcpcsCodes,
      hasPayment: t.drugs.hasPayment,
      isListed: t.drugs.isListed,
      activeUntil: t.drugs.activeUntil,
      dosageForms: t.drugs.dosageForms,
      routes: t.drugs.routes,
    })
    .from(t.drugs)
    .where(sql`${m.id} = ANY(${t.drugs.manufacturerIds})`)
    .orderBy(asc(t.drugs.displayName));
  const { latest } = await loadReleases(db);
  const fdaRelease = latest.get("fda_ndc");
  const xwRelease = latest.get("cms_ndc_hcpcs");
  return {
    manufacturer: m,
    drugs: drugs.map((d) => ({ ...d, isActive: d.isListed && (!d.activeUntil || d.activeUntil >= today()) })),
    provenance: [fdaRelease, m.hcpcsCodes.length ? xwRelease : undefined].filter((r): r is ReleaseRow => !!r).map((r) => toProvenance(r)),
  };
}

export type ManufacturerDetail = NonNullable<Awaited<ReturnType<typeof getManufacturerDetail>>>;

/* ------------------------------------------------------------------ */
/* Sources, home page, browse                                          */
/* ------------------------------------------------------------------ */

export async function getSourcesOverview(dbArg?: Database) {
  const db = dbArg ?? (await getDb());
  const releases = await db.select().from(t.sourceReleases).orderBy(asc(t.sourceReleases.sourceKey), desc(t.sourceReleases.periodLabel), desc(t.sourceReleases.id));
  return {
    releases: releases.map((r) => ({
      ...toProvenance(r),
      fileName: r.fileName,
      byteSize: r.byteSize,
      recordCount: r.recordCount,
      releaseStatus: r.status,
      error: r.error,
      report: r.report as Record<string, unknown> | null,
    })),
  };
}

export async function getHomeData(dbArg?: Database) {
  const db = dbArg ?? (await getDb());
  const { latest } = await loadReleases(db);
  const hcpcsPeriod = latest.get("cms_hcpcs")?.periodLabel ?? null;
  const paymentPeriod = latest.get("cms_payment_limits")?.periodLabel ?? null;
  const [counts] = rowsOf<{ codes: number; drug_codes: number; drugs: number; packages: number; paid: number }>(
    await db.execute(sql`SELECT
      (SELECT count(*)::int FROM hcpcs_codes) AS codes,
      (SELECT count(*)::int FROM hcpcs_codes WHERE is_drug) AS drug_codes,
      (SELECT count(*)::int FROM drugs) AS drugs,
      (SELECT count(*)::int FROM ndc_packages) AS packages,
      (SELECT count(DISTINCT hcpcs_code)::int FROM payment_limits WHERE period = ${paymentPeriod ?? ""}) AS paid`),
  );
  const newCodes = hcpcsPeriod
    ? await db
        .select({ code: t.hcpcsCodes.code, longDescription: t.hcpcsCodes.longDescription, addedDate: t.hcpcsCodes.addedDate })
        .from(t.hcpcsCodeHistory)
        .innerJoin(t.hcpcsCodes, eq(t.hcpcsCodes.code, t.hcpcsCodeHistory.code))
        .where(and(eq(t.hcpcsCodeHistory.period, hcpcsPeriod), eq(t.hcpcsCodeHistory.changeType, "added"), eq(t.hcpcsCodes.isDrug, true)))
        .orderBy(asc(t.hcpcsCodes.code))
        .limit(12)
    : [];
  return {
    hcpcsPeriod,
    paymentPeriod,
    counts: counts ?? { codes: 0, drug_codes: 0, drugs: 0, packages: 0, paid: 0 },
    newCodes,
    sources: [...latest.values()].map((r) => toProvenance(r)).sort((a, b) => a.sourceKey.localeCompare(b.sourceKey)),
  };
}

export async function getFamilyListing(letter: string, opts: { page: number; pageSize: number; status: "active" | "inactive" | "all"; drugOnly: boolean }, dbArg?: Database) {
  const db = dbArg ?? (await getDb());
  const family = CODE_FAMILIES[letter.toUpperCase()];
  if (!family) return null;
  const conds = [eq(t.hcpcsCodes.family, family.letter)];
  if (opts.status === "active") conds.push(sql`(${t.hcpcsCodes.terminationDate} IS NULL OR ${t.hcpcsCodes.terminationDate} >= CURRENT_DATE)`);
  if (opts.status === "inactive") conds.push(sql`(${t.hcpcsCodes.terminationDate} < CURRENT_DATE)`);
  if (opts.drugOnly) conds.push(eq(t.hcpcsCodes.isDrug, true));
  const where = and(...conds);
  const [{ n }] = rowsOf<{ n: number }>(await db.execute(sql`SELECT count(*)::int AS n FROM hcpcs_codes WHERE ${where}`));
  const rows = await db
    .select({
      code: t.hcpcsCodes.code,
      shortDescription: t.hcpcsCodes.shortDescription,
      longDescription: t.hcpcsCodes.longDescription,
      terminationDate: t.hcpcsCodes.terminationDate,
      addedDate: t.hcpcsCodes.addedDate,
      isNoc: t.hcpcsCodes.isNoc,
      isDrug: t.hcpcsCodes.isDrug,
    })
    .from(t.hcpcsCodes)
    .where(where)
    .orderBy(asc(t.hcpcsCodes.code))
    .limit(opts.pageSize)
    .offset((opts.page - 1) * opts.pageSize);
  const { byId, latest } = await loadReleases(db);
  const pay = await paymentHistory(db, rows.map((r) => r.code), byId);
  const paymentPeriod = latest.get("cms_payment_limits")?.periodLabel ?? null;
  return {
    family,
    total: n,
    rows: rows.map((r) => {
      const p = pay.get(r.code)?.find((x) => x.period === paymentPeriod) ?? null;
      return { ...r, isActive: isCodeActive(r.terminationDate, today()), paymentLimit: p?.paymentLimit ?? null, dosage: p?.dosageDescriptor ?? null };
    }),
    paymentPeriod,
    provenance: [latest.get("cms_hcpcs"), latest.get("cms_payment_limits")].filter((r): r is ReleaseRow => !!r).map((r) => toProvenance(r)),
  };
}

export async function getFamilyCounts(dbArg?: Database) {
  const db = dbArg ?? (await getDb());
  return rowsOf<{ family: string; total: number; active: number; drug: number }>(
    await db.execute(sql`SELECT family, count(*)::int AS total,
      count(*) FILTER (WHERE termination_date IS NULL OR termination_date >= CURRENT_DATE)::int AS active,
      count(*) FILTER (WHERE is_drug)::int AS drug
      FROM hcpcs_codes GROUP BY family ORDER BY family`),
  );
}

/** For the sitemap: indexable detail pages. */
export async function getSitemapEntries(dbArg?: Database) {
  const db = dbArg ?? (await getDb());
  const codes = await db.select({ code: t.hcpcsCodes.code }).from(t.hcpcsCodes).where(eq(t.hcpcsCodes.isDrug, true));
  // Only pages that carry CMS coding data are indexable (others are marked noindex).
  const drugs = await db.select({ slug: t.drugs.slug }).from(t.drugs).where(sql`cardinality(${t.drugs.hcpcsCodes}) > 0`);
  const mfrs = await db.select({ slug: t.manufacturers.slug }).from(t.manufacturers).where(sql`cardinality(${t.manufacturers.hcpcsCodes}) > 0`);
  return { codes: codes.map((c) => c.code), drugs: drugs.map((d) => d.slug), manufacturers: mfrs.map((m) => m.slug) };
}

export async function getHealth(dbArg?: Database) {
  const db = dbArg ?? (await getDb());
  const started = performance.now();
  const [row] = rowsOf<{ now: string; codes: number; drugs: number; releases: number }>(
    await db.execute(sql`SELECT now()::text AS now, (SELECT count(*)::int FROM hcpcs_codes) AS codes, (SELECT count(*)::int FROM drugs) AS drugs, (SELECT count(*)::int FROM source_releases WHERE status = 'succeeded') AS releases`),
  );
  const { latest } = await loadReleases(db);
  return {
    dbLatencyMs: Math.round(performance.now() - started),
    counts: { hcpcsCodes: row.codes, drugs: row.drugs, releases: row.releases },
    latest: Object.fromEntries([...latest.entries()].map(([k, r]) => [k, { period: r.periodLabel, importedAt: r.importedAt, releaseId: r.id }])),
  };
}
