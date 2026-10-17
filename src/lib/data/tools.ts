/**
 * Read models for the Tools section: chargemaster/formulary audit, biosimilar
 * comparison, and the quarterly change report. Every finding is a direct reading
 * of an official field; nothing is inferred from names.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { EXCLUDE_FLAG_LABELS, formatPeriod } from "@/lib/format";
import { isCodeActive } from "@/lib/hcpcs";
import { medicaidFlags, type MedicaidInfo } from "@/lib/medicaid";
import type { MueEntry } from "@/lib/mue";
import { formatNdc11 } from "@/lib/ndc";
import { loadReleases, toProvenance, type Provenance, type ReleaseRow } from "./provenance";
import { medicaidFor, mueFor, mueReleases } from "./queries";

const today = () => new Date().toISOString().slice(0, 10);

/* ------------------------------------------------------------------ */
/* Chargemaster / formulary audit                                      */
/* ------------------------------------------------------------------ */

export interface AuditItem {
  hcpcs?: string | null;
  ndc11?: string | null;
}

export type FindingLevel = "error" | "warning" | "info" | "ok";

export interface Finding {
  level: FindingLevel;
  text: string;
}

export interface AuditCodeInfo {
  code: string;
  inFile: boolean;
  shortDescription: string | null;
  longDescription: string | null;
  isDrug: boolean;
  isNoc: boolean;
  isActive: boolean;
  terminationDate: string | null;
  payment: { period: string; limit: string | null; limitText: string | null; dosage: string | null; coinsurancePct: string | null; methodology: string | null } | null;
  notPayable: boolean;
  mue: MueEntry[];
  crosswalkNdcs: number;
}

export interface AuditNdcInfo {
  ndc11: string;
  formatted: string;
  fda: { listingStatus: string; excludeFlag: string | null; marketingEnd: string | null; isActive: boolean; description: string | null; drugName: string | null; drugSlug: string | null; labeler: string | null } | null;
  crosswalk: {
    hcpcsCode: string | null;
    billUnitsPerPackage: string | null;
    billUnitsPerItem: string | null;
    hcpcsDosage: string | null;
    types: string[];
    /** Current Part B payment limit of the crosswalked code, when CMS publishes one. */
    payment: { period: string; limit: string | null; dosage: string | null; coinsurancePct: string | null } | null;
  }[];
  medicaid: MedicaidInfo | null;
}

export interface AuditRow {
  index: number;
  code: AuditCodeInfo | null;
  ndc: AuditNdcInfo | null;
  /** True when CMS crosswalks this NDC to this code in the latest crosswalk. */
  pairMatches: boolean | null;
  findings: Finding[];
  worst: FindingLevel;
}

const RANK: Record<FindingLevel, number> = { error: 3, warning: 2, info: 1, ok: 0 };

export async function auditItems(items: AuditItem[], dbArg?: Database) {
  const db = dbArg ?? (await getDb());
  const { latest } = await loadReleases(db);
  const payPeriod = latest.get("cms_payment_limits")?.periodLabel ?? null;
  const xwRelease = latest.get("cms_ndc_hcpcs") ?? null;
  const xwPeriod = xwRelease?.periodLabel ?? null;
  const codes = [...new Set(items.map((i) => i.hcpcs).filter((c): c is string => !!c))];
  const ndcs = [...new Set(items.map((i) => i.ndc11).filter((n): n is string => !!n))];

  const [codeRows, notPayableRows, mue, xwByCode, xwByNdc, fdaRows] = await Promise.all([
    codes.length ? db.select().from(t.hcpcsCodes).where(inArray(t.hcpcsCodes.code, codes)) : [],
    codes.length && payPeriod
      ? db
          .select({ code: t.partBNotPayable.hcpcsCode })
          .from(t.partBNotPayable)
          .innerJoin(t.sourceReleases, and(eq(t.sourceReleases.id, t.partBNotPayable.sourceReleaseId), eq(t.sourceReleases.isCurrent, true)))
          .where(and(inArray(t.partBNotPayable.hcpcsCode, codes), eq(t.partBNotPayable.period, payPeriod)))
      : [],
    mueFor(db, codes, latest),
    codes.length && xwRelease
      ? db
          .select({ code: t.ndcHcpcsCrosswalk.hcpcsCode, n: sql<number>`count(DISTINCT ${t.ndcHcpcsCrosswalk.ndc11})::int` })
          .from(t.ndcHcpcsCrosswalk)
          .where(and(inArray(t.ndcHcpcsCrosswalk.hcpcsCode, codes), eq(t.ndcHcpcsCrosswalk.sourceReleaseId, xwRelease.id)))
          .groupBy(t.ndcHcpcsCrosswalk.hcpcsCode)
      : [],
    ndcs.length && xwRelease
      ? db
          .select()
          .from(t.ndcHcpcsCrosswalk)
          .where(and(inArray(t.ndcHcpcsCrosswalk.ndc11, ndcs), eq(t.ndcHcpcsCrosswalk.sourceReleaseId, xwRelease.id)))
      : [],
    ndcs.length
      ? db
          .select({
            ndc11: t.ndcPackages.ndc11,
            listingStatus: t.ndcPackages.listingStatus,
            excludeFlag: t.ndcPackages.excludeFlag,
            marketingEnd: t.ndcPackages.marketingEnd,
            description: t.ndcPackages.description,
            drugName: t.drugs.displayName,
            drugSlug: t.drugs.slug,
            labeler: t.ndcProducts.labelerName,
          })
          .from(t.ndcPackages)
          .innerJoin(t.ndcProducts, eq(t.ndcProducts.productId, t.ndcPackages.productId))
          .leftJoin(t.drugs, eq(t.drugs.id, t.ndcProducts.drugId))
          .where(inArray(t.ndcPackages.ndc11, ndcs))
      : [],
  ]);

  const medicaid = await medicaidFor(db, ndcs);
  const mdrpPeriod = latest.get("cms_mdrp_products")?.periodLabel ?? null;
  const payCodes = [...new Set([...codes, ...xwByNdc.map((x) => x.hcpcsCode).filter((c): c is string => !!c)])];
  const payRows =
    payCodes.length && payPeriod
      ? await db
          .select({ p: t.paymentLimits })
          .from(t.paymentLimits)
          .innerJoin(t.sourceReleases, and(eq(t.sourceReleases.id, t.paymentLimits.sourceReleaseId), eq(t.sourceReleases.isCurrent, true)))
          .where(and(inArray(t.paymentLimits.hcpcsCode, payCodes), eq(t.paymentLimits.period, payPeriod)))
      : [];
  const codeInfo = new Map<string, AuditCodeInfo>();
  for (const code of codes) {
    const row = codeRows.find((r) => r.code === code);
    const pay = payRows.find((p) => p.p.hcpcsCode === code)?.p;
    codeInfo.set(code, {
      code,
      inFile: !!row,
      shortDescription: row?.shortDescription ?? null,
      longDescription: row?.longDescription ?? null,
      isDrug: row?.isDrug ?? false,
      isNoc: row?.isNoc ?? false,
      isActive: row ? isCodeActive(row.terminationDate, today()) : false,
      terminationDate: row?.terminationDate ?? null,
      payment: pay ? { period: pay.period, limit: pay.paymentLimit, limitText: pay.paymentLimitText, dosage: pay.dosageDescriptor, coinsurancePct: pay.coinsurancePct, methodology: pay.methodology } : null,
      notPayable: notPayableRows.some((n) => n.code === code),
      mue: mue.get(code) ?? [],
      crosswalkNdcs: xwByCode.find((x) => x.code === code)?.n ?? 0,
    });
  }

  const ndcInfo = new Map<string, AuditNdcInfo>();
  for (const ndc of ndcs) {
    const fda = fdaRows.find((f) => f.ndc11 === ndc && f.listingStatus === "listed") ?? fdaRows.find((f) => f.ndc11 === ndc);
    const xw = new Map<string, AuditNdcInfo["crosswalk"][number]>();
    for (const x of xwByNdc.filter((r) => r.ndc11 === ndc)) {
      const key = x.hcpcsCode ?? "NOC";
      const cur = xw.get(key);
      if (cur) cur.types = [...new Set([...cur.types, x.crosswalkType])];
      else {
        const p = x.hcpcsCode ? payRows.find((r) => r.p.hcpcsCode === x.hcpcsCode)?.p : undefined;
        xw.set(key, {
          hcpcsCode: x.hcpcsCode,
          billUnitsPerPackage: x.billUnitsPerPackage,
          billUnitsPerItem: x.billUnitsPerItem,
          hcpcsDosage: x.hcpcsDosage,
          types: [x.crosswalkType],
          payment: p ? { period: p.period, limit: p.paymentLimit, dosage: p.dosageDescriptor, coinsurancePct: p.coinsurancePct } : null,
        });
      }
    }
    ndcInfo.set(ndc, {
      ndc11: ndc,
      formatted: formatNdc11(ndc),
      fda: fda
        ? {
            listingStatus: fda.listingStatus,
            excludeFlag: fda.excludeFlag,
            marketingEnd: fda.marketingEnd,
            isActive: fda.listingStatus === "listed" && (!fda.marketingEnd || fda.marketingEnd >= today()),
            description: fda.description,
            drugName: fda.drugName,
            drugSlug: fda.drugSlug,
            labeler: fda.labeler,
          }
        : null,
      crosswalk: [...xw.values()],
      medicaid: medicaid.get(ndc) ?? null,
    });
  }

  const xwLabel = xwPeriod ? formatPeriod(xwPeriod) : "the latest file";
  const rows: AuditRow[] = items.map((item, index) => {
    const findings: Finding[] = [];
    const c = item.hcpcs ? codeInfo.get(item.hcpcs)! : null;
    const n = item.ndc11 ? ndcInfo.get(item.ndc11)! : null;
    if (c) {
      if (!c.inFile) findings.push({ level: "error", text: `${c.code} is not in the CMS HCPCS files CodeRx has imported.` });
      else {
        if (!c.isActive) findings.push({ level: "error", text: `${c.code} was terminated ${c.terminationDate}.` });
        else if (c.terminationDate) findings.push({ level: "warning", text: `${c.code} has a scheduled termination date of ${c.terminationDate}.` });
        if (c.notPayable) findings.push({ level: "error", text: `${c.code} is on the CMS “Drugs Not Payable Under Part B” list for ${payPeriod ? formatPeriod(payPeriod) : "the latest quarter"}.` });
        if (c.isNoc) findings.push({ level: "info", text: `${c.code} is a not-otherwise-classified code: the MAC prices it, and claims need the drug name, NDC, and dose.` });
        else if (c.isDrug && c.isActive && !c.payment) findings.push({ level: "warning", text: `No Part B payment limit for ${c.code} in ${payPeriod ? formatPeriod(payPeriod) : "the latest file"}.` });
      }
    }
    if (n) {
      if (!n.fda) findings.push({ level: "warning", text: `${n.formatted} is not among the FDA NDC Directory records CodeRx keeps (clinician-administered and CMS-crosswalked products).` });
      else if (n.fda.listingStatus === "excluded")
        findings.push({ level: "warning", text: `${n.formatted} was removed from the active FDA directory: ${EXCLUDE_FLAG_LABELS[n.fda.excludeFlag ?? ""] ?? `flag ${n.fda.excludeFlag ?? "unknown"}`}.` });
      else if (!n.fda.isActive) findings.push({ level: "warning", text: `FDA lists a marketing end date of ${n.fda.marketingEnd} for ${n.formatted}.` });
      if (n.medicaid) for (const f of medicaidFlags(n.medicaid, today())) findings.push({ level: "warning", text: `${n.formatted}: ${f}` });
      else if (mdrpPeriod)
        findings.push({ level: "info", text: `${n.formatted} is not in the CMS Medicaid Drug Rebate Program product file for ${formatPeriod(mdrpPeriod)}; Medicaid generally requires a rebate agreement.` });
      const xwCodes = n.crosswalk.map((x) => x.hcpcsCode).filter((x): x is string => !!x);
      if (!n.crosswalk.length) findings.push({ level: c ? "warning" : "info", text: `${n.formatted} is not on the CMS NDC–HCPCS crosswalk for ${xwLabel}.` });
      else if (!c) findings.push({ level: "info", text: `CMS crosswalks ${n.formatted} to ${xwCodes.join(", ") || "a NOC entry"} (${xwLabel}).` });
    }
    let pairMatches: boolean | null = null;
    if (c && n && n.crosswalk.length) {
      const match = n.crosswalk.find((x) => x.hcpcsCode === c.code);
      pairMatches = !!match;
      if (match) findings.push({ level: "ok", text: `CMS crosswalks ${n.formatted} to ${c.code}: ${match.billUnitsPerPackage ?? "?"} billable unit(s) per package (${xwLabel}).` });
      else findings.push({ level: "error", text: `CMS crosswalks ${n.formatted} to ${n.crosswalk.map((x) => x.hcpcsCode ?? "a NOC entry").join(", ")}, not ${c.code} (${xwLabel}).` });
    }
    if (!findings.length) findings.push({ level: "ok", text: "No issues found in the imported CMS and FDA data." });
    const worst = findings.reduce<FindingLevel>((w, f) => (RANK[f.level] > RANK[w] ? f.level : w), "ok");
    return { index, code: c, ndc: n, pairMatches, findings, worst };
  });

  const provenance: Provenance[] = (["cms_hcpcs", "cms_payment_limits", "cms_ndc_hcpcs", "fda_ndc", "fda_ndc_excluded", "cms_mdrp_products"] as const)
    .map((k) => latest.get(k))
    .filter((r): r is ReleaseRow => !!r)
    .map((r) => toProvenance(r));
  provenance.push(...mueReleases(latest));
  return { rows, paymentPeriod: payPeriod, crosswalkPeriod: xwPeriod, provenance };
}

export type AuditResult = Awaited<ReturnType<typeof auditItems>>;

/* ------------------------------------------------------------------ */
/* Biosimilar comparison                                               */
/* ------------------------------------------------------------------ */

export interface ComparatorProduct {
  slug: string;
  displayName: string;
  genericName: string | null;
  role: "reference" | "biosimilar" | "interchangeable";
  codes: { code: string; longDescription: string | null; isActive: boolean; payment: { period: string; limit: string | null; dosage: string | null; coinsurancePct: string | null; methodology: string | null; notes: string | null } | null }[];
}

export interface ComparatorGroup {
  referenceSlug: string;
  referenceName: string;
  genericName: string | null;
  products: ComparatorProduct[];
}

/** Reference biologics with FDA-licensed biosimilars (Purple Book) and their Part B payment limits. */
export async function biosimilarGroups(dbArg?: Database) {
  const db = dbArg ?? (await getDb());
  const { latest } = await loadReleases(db);
  const payPeriod = latest.get("cms_payment_limits")?.periodLabel ?? null;
  const biosimilars = await db
    .select({ slug: t.drugs.slug, displayName: t.drugs.displayName, genericName: t.drugs.genericName, status: t.drugs.biosimilarStatus, referenceDrugId: t.drugs.referenceDrugId, codes: t.drugs.hcpcsCodes })
    .from(t.drugs)
    .where(sql`${t.drugs.referenceDrugId} IS NOT NULL AND cardinality(${t.drugs.hcpcsCodes}) > 0`)
    .orderBy(asc(t.drugs.displayName));
  const refIds = [...new Set(biosimilars.map((b) => b.referenceDrugId!))];
  const refs = refIds.length
    ? await db
        .select({ id: t.drugs.id, slug: t.drugs.slug, displayName: t.drugs.displayName, genericName: t.drugs.genericName, codes: t.drugs.hcpcsCodes })
        .from(t.drugs)
        .where(inArray(t.drugs.id, refIds))
    : [];
  const allCodes = [...new Set([...biosimilars.flatMap((b) => b.codes), ...refs.flatMap((r) => r.codes)])];
  const [codeRows, payRows] = await Promise.all([
    allCodes.length ? db.select({ code: t.hcpcsCodes.code, longDescription: t.hcpcsCodes.longDescription, terminationDate: t.hcpcsCodes.terminationDate }).from(t.hcpcsCodes).where(inArray(t.hcpcsCodes.code, allCodes)) : [],
    allCodes.length && payPeriod
      ? db
          .select({ p: t.paymentLimits })
          .from(t.paymentLimits)
          .innerJoin(t.sourceReleases, and(eq(t.sourceReleases.id, t.paymentLimits.sourceReleaseId), eq(t.sourceReleases.isCurrent, true)))
          .where(and(inArray(t.paymentLimits.hcpcsCode, allCodes), eq(t.paymentLimits.period, payPeriod)))
      : [],
  ]);
  const codeInfo = (codes: string[]) =>
    codes
      .map((code) => {
        const row = codeRows.find((r) => r.code === code);
        const p = payRows.find((x) => x.p.hcpcsCode === code)?.p;
        return {
          code,
          longDescription: row?.longDescription ?? null,
          isActive: row ? isCodeActive(row.terminationDate, today()) : false,
          payment: p ? { period: p.period, limit: p.paymentLimit, dosage: p.dosageDescriptor, coinsurancePct: p.coinsurancePct, methodology: p.methodology, notes: p.notes } : null,
        };
      })
      .sort((a, b) => Number(b.isActive) - Number(a.isActive) || Number(!!b.payment) - Number(!!a.payment) || a.code.localeCompare(b.code));

  const groups: ComparatorGroup[] = refs
    .map((r) => ({
      referenceSlug: r.slug,
      referenceName: r.displayName,
      genericName: r.genericName,
      products: [
        { slug: r.slug, displayName: r.displayName, genericName: r.genericName, role: "reference" as const, codes: codeInfo(r.codes) },
        ...biosimilars
          .filter((b) => b.referenceDrugId === r.id)
          .map((b) => ({ slug: b.slug, displayName: b.displayName, genericName: b.genericName, role: (b.status === "interchangeable" ? "interchangeable" : "biosimilar") as ComparatorProduct["role"], codes: codeInfo(b.codes) })),
      ],
    }))
    .filter((g) => g.products.some((p) => p.codes.some((c) => c.payment)))
    .sort((a, b) => (a.genericName ?? a.referenceName).localeCompare(b.genericName ?? b.referenceName));

  const provenance = (["cms_payment_limits", "fda_purple_book", "cms_ndc_hcpcs"] as const)
    .map((k) => latest.get(k))
    .filter((r): r is ReleaseRow => !!r)
    .map((r) => toProvenance(r));
  return { groups, paymentPeriod: payPeriod, provenance };
}

/* ------------------------------------------------------------------ */
/* Quarterly change report                                             */
/* ------------------------------------------------------------------ */

export interface LimitChange {
  code: string;
  shortDescription: string | null;
  dosage: string | null;
  before: number;
  after: number;
  changePct: number;
  isDrug: boolean;
}

export async function quarterlyChanges(period: string | null, dbArg?: Database) {
  const db = dbArg ?? (await getDb());
  const { latest } = await loadReleases(db);
  const periods = (
    await db
      .selectDistinct({ period: t.paymentLimits.period })
      .from(t.paymentLimits)
      .innerJoin(t.sourceReleases, and(eq(t.sourceReleases.id, t.paymentLimits.sourceReleaseId), eq(t.sourceReleases.isCurrent, true)))
      .orderBy(desc(t.paymentLimits.period))
  ).map((r) => r.period);
  const current = period && periods.includes(period) ? period : periods[0] ?? null;
  const previous = current ? (periods.find((p) => p < current) ?? null) : null;
  if (!current) return { period: null, previous: null, periods, limitChanges: [], added: [], removed: [], newCodes: [], terminatedCodes: [], crosswalk: { added: [], removed: [], period: null, previous: null }, provenance: [] };

  const limitsFor = async (p: string) =>
    db
      .select({ code: t.paymentLimits.hcpcsCode, limit: t.paymentLimits.paymentLimit, dosage: t.paymentLimits.dosageDescriptor, short: t.paymentLimits.shortDescription })
      .from(t.paymentLimits)
      .innerJoin(t.sourceReleases, and(eq(t.sourceReleases.id, t.paymentLimits.sourceReleaseId), eq(t.sourceReleases.isCurrent, true)))
      .where(eq(t.paymentLimits.period, p));
  const [now, before] = await Promise.all([limitsFor(current), previous ? limitsFor(previous) : Promise.resolve([])]);
  const beforeMap = new Map(before.map((b) => [b.code, b]));
  const nowMap = new Map(now.map((b) => [b.code, b]));
  const allCodes = [...new Set([...nowMap.keys(), ...beforeMap.keys()])];
  const drugCodes = new Set(
    allCodes.length
      ? (await db.select({ code: t.hcpcsCodes.code }).from(t.hcpcsCodes).where(and(inArray(t.hcpcsCodes.code, allCodes), eq(t.hcpcsCodes.isDrug, true)))).map((r) => r.code)
      : [],
  );
  const limitChanges: LimitChange[] = [];
  for (const n of now) {
    const b = beforeMap.get(n.code);
    if (!b || n.limit == null || b.limit == null) continue;
    const after = Number(n.limit);
    const prior = Number(b.limit);
    if (!(prior > 0) || after === prior) continue;
    limitChanges.push({ code: n.code, shortDescription: n.short, dosage: n.dosage, before: prior, after, changePct: Math.round(((after - prior) / prior) * 1000) / 10, isDrug: drugCodes.has(n.code) });
  }
  limitChanges.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
  const added = previous ? now.filter((n) => !beforeMap.has(n.code)).map((n) => ({ code: n.code, shortDescription: n.short, dosage: n.dosage, limit: n.limit })) : [];
  const removed = previous ? before.filter((b) => !nowMap.has(b.code)).map((b) => ({ code: b.code, shortDescription: b.short, dosage: b.dosage, limit: b.limit })) : [];

  // HCPCS file changes for the same quarter (drug codes only).
  const hist = await db
    .select({ code: t.hcpcsCodeHistory.code, changeType: t.hcpcsCodeHistory.changeType, longDescription: t.hcpcsCodes.longDescription, terminationDate: t.hcpcsCodes.terminationDate, addedDate: t.hcpcsCodes.addedDate })
    .from(t.hcpcsCodeHistory)
    .innerJoin(t.hcpcsCodes, eq(t.hcpcsCodes.code, t.hcpcsCodeHistory.code))
    .where(and(eq(t.hcpcsCodeHistory.period, current), eq(t.hcpcsCodes.isDrug, true), inArray(t.hcpcsCodeHistory.changeType, ["added", "terminated"])))
    .orderBy(asc(t.hcpcsCodeHistory.code));

  // NDC–HCPCS crosswalk changes between the two newest crosswalk quarters.
  const xwPeriods = (
    await db
      .selectDistinct({ period: t.ndcHcpcsCrosswalk.period })
      .from(t.ndcHcpcsCrosswalk)
      .orderBy(desc(t.ndcHcpcsCrosswalk.period))
  ).map((r) => r.period);
  const xwNow = xwPeriods.includes(current) ? current : null;
  const xwPrev = xwNow ? (xwPeriods.find((p) => p < xwNow) ?? null) : null;
  let xwAdded: { ndc11: string; formatted: string; hcpcsCode: string | null; labeler: string | null; drugName: string | null }[] = [];
  let xwRemoved: typeof xwAdded = [];
  if (xwNow && xwPrev) {
    const rowsFor = async (p: string) =>
      db
        .selectDistinct({ ndc11: t.ndcHcpcsCrosswalk.ndc11, hcpcsCode: t.ndcHcpcsCrosswalk.hcpcsCode, labeler: t.ndcHcpcsCrosswalk.labelerName, drugName: t.ndcHcpcsCrosswalk.drugName })
        .from(t.ndcHcpcsCrosswalk)
        .where(and(eq(t.ndcHcpcsCrosswalk.period, p), eq(t.ndcHcpcsCrosswalk.crosswalkType, "ASP"), sql`${t.ndcHcpcsCrosswalk.ndc11} IS NOT NULL`));
    const [a, b] = await Promise.all([rowsFor(xwNow), rowsFor(xwPrev)]);
    const key = (r: { ndc11: string | null; hcpcsCode: string | null }) => `${r.ndc11}|${r.hcpcsCode}`;
    const bKeys = new Set(b.map(key));
    const aKeys = new Set(a.map(key));
    const shape = (r: (typeof a)[number]) => ({ ndc11: r.ndc11!, formatted: formatNdc11(r.ndc11!), hcpcsCode: r.hcpcsCode, labeler: r.labeler, drugName: r.drugName });
    xwAdded = a.filter((r) => !bKeys.has(key(r))).map(shape);
    xwRemoved = b.filter((r) => !aKeys.has(key(r))).map(shape);
  }

  const provenance = (["cms_payment_limits", "cms_hcpcs", "cms_ndc_hcpcs"] as const)
    .map((k) => latest.get(k))
    .filter((r): r is ReleaseRow => !!r)
    .map((r) => toProvenance(r));
  return {
    period: current,
    previous,
    periods,
    limitChanges,
    added,
    removed,
    newCodes: hist.filter((h) => h.changeType === "added"),
    terminatedCodes: hist.filter((h) => h.changeType === "terminated"),
    crosswalk: { added: xwAdded, removed: xwRemoved, period: xwNow, previous: xwPrev },
    provenance,
  };
}

export type QuarterlyChanges = Awaited<ReturnType<typeof quarterlyChanges>>;
