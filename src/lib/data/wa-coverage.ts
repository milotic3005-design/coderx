/**
 * Read model for /tools/wa-coverage: one drug name in, coverage across Washington plans out.
 * RxNorm (NLM's RxNav) turns the name into product IDs and NDCs; the rules in src/lib/wa-coverage.ts
 * read the Apple Health PDL, Washington Part D formularies, exchange insurers' files, and NADAC.
 */
import { and, eq, inArray } from "drizzle-orm";
import { WA_EXCHANGE_INSURERS, WA_INSURER_KEYS } from "@/ingest/wa-formularies";
import { getDb, type Database } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { exchangeCopayRows, partdCopayRows, sortCopays, type CopayRow } from "@/lib/copay-compare";
import { matchRxNorm, type RxNormResult } from "@/lib/rxnorm";
import { appleHealthRow, exchangeRows, insulinKind, partDRow, referencePrice, type CoverageRow, type ReferencePrice } from "@/lib/wa-coverage";
import { toProvenance, type Provenance, type ReleaseRow } from "./provenance";

export const UMP_PDL_URL = "https://www.hca.wa.gov/assets/pebb/ump-preferred-drug-list.pdf";

export interface CoverageGroup {
  key: "apple_health" | "partd" | `exchange_${string}` | "ump";
  title: string;
  /** "missing": the source is not loaded yet. "link-only": CodeRx does not read this source (see note). */
  state: "ok" | "missing" | "link-only";
  rows: CoverageRow[];
  note: string | null;
  provenance: Provenance[];
}

export interface WaCoverageData {
  query: string;
  lookup: RxNormResult;
  groups: CoverageGroup[];
  /** Null when NADAC is not loaded yet. */
  reference: (ReferencePrice & { provenance: Provenance[] }) | null;
  /** Each listing plan's stated cost sharing for the drug, sorted (flat copays lowest first). */
  copays: { rows: CopayRow[]; provenance: Provenance[]; partdLoaded: boolean; exchangeMissing: string[]; insulin: "all" | "some" | "none" };
}

const WA_SOURCES = ["wa_hca_pdl", "wa_exchange_formularies", "cms_partd_wa", "cms_nadac"] as const;

function umpGroup(): CoverageGroup {
  return {
    key: "ump",
    title: "PEBB/SEBB: Uniform Medical Plan (UMP)",
    state: "link-only",
    rows: [],
    note: "UMP's preferred drug list is a PDF that lists drug names without NDCs or RxCUIs. CodeRx matches drugs by code only, so it does not read this list: look the drug up in the PDF. Other PEBB/SEBB plans (Kaiser Permanente, UMP Plus) publish their own lists.",
    provenance: [],
  };
}

/** `db` and `lookup` can be given for tests (a seeded database, a fixed RxNorm answer). */
export async function waCoverage(query: string, options: { db?: Database; lookup?: (q: string) => Promise<RxNormResult> } = {}): Promise<WaCoverageData> {
  const lookup = await (options.lookup ?? matchRxNorm)(query);
  if (lookup.kind !== "match") return { query, lookup, groups: [], reference: null, copays: { rows: [], provenance: [], partdLoaded: false, exchangeMissing: [], insulin: "none" } };
  const { match } = lookup;
  const db = options.db ?? (await getDb());

  const releases = await db
    .select()
    .from(t.sourceReleases)
    .where(and(inArray(t.sourceReleases.sourceKey, [...WA_SOURCES]), eq(t.sourceReleases.isCurrent, true), eq(t.sourceReleases.status, "succeeded")));
  const current = (key: (typeof WA_SOURCES)[number], period?: string) => releases.filter((r) => r.sourceKey === key && (period === undefined || r.periodLabel === period));
  const newest = (rows: ReleaseRow[]) => [...rows].sort((a, b) => (b.periodLabel ?? "").localeCompare(a.periodLabel ?? ""))[0];
  const ids = (rows: ReleaseRow[]) => rows.map((r) => r.id);
  const ndcs = match.ndcs.length ? match.ndcs : ["-"];
  const rxcuis = match.rxcuis.length ? match.rxcuis : ["-"];

  const pdlRelease = newest(current("wa_hca_pdl"));
  const nadacRelease = newest(current("cms_nadac"));
  const partdRelease = newest(current("cms_partd_wa"));
  const exchangeReleases = current("wa_exchange_formularies");

  const [pdl, nadac, formularies, partdRows, exchangePlans, exchangeDrugs, partdPlans] = await Promise.all([
    pdlRelease ? db.select().from(t.waPdlNdcs).where(and(eq(t.waPdlNdcs.sourceReleaseId, pdlRelease.id), inArray(t.waPdlNdcs.ndc11, ndcs))) : [],
    nadacRelease ? db.select().from(t.nadacPrices).where(and(eq(t.nadacPrices.sourceReleaseId, nadacRelease.id), inArray(t.nadacPrices.ndc11, ndcs))) : [],
    partdRelease ? db.select().from(t.partdWaFormularies) : [],
    partdRelease ? db.select().from(t.partdWaFormularyDrugs).where(inArray(t.partdWaFormularyDrugs.rxcui, rxcuis)) : [],
    exchangeReleases.length ? db.select().from(t.waExchangePlans).where(inArray(t.waExchangePlans.sourceReleaseId, ids(exchangeReleases))) : [],
    exchangeReleases.length ? db.select().from(t.waExchangeDrugs).where(and(inArray(t.waExchangeDrugs.sourceReleaseId, ids(exchangeReleases)), inArray(t.waExchangeDrugs.rxcui, rxcuis))) : [],
    partdRelease ? db.select().from(t.partdWaPlans) : [],
  ]);

  const missing = (key: CoverageGroup["key"], title: string): CoverageGroup => ({ key, title, state: "missing", rows: [], note: "This source is not loaded into CodeRx yet.", provenance: [] });
  const groups: CoverageGroup[] = [
    pdlRelease
      ? { key: "apple_health", title: "Washington Apple Health (Medicaid)", state: "ok", rows: [appleHealthRow(match, pdl)], note: null, provenance: [toProvenance(pdlRelease)] }
      : missing("apple_health", "Washington Apple Health (Medicaid)"),
    partdRelease
      ? { key: "partd", title: "Medicare Part D (Washington plans)", state: "ok", rows: [partDRow(match, formularies, partdRows)], note: null, provenance: [toProvenance(partdRelease)] }
      : missing("partd", "Medicare Part D (Washington plans)"),
    ...WA_INSURER_KEYS.map((key): CoverageGroup => {
      const insurer = WA_EXCHANGE_INSURERS[key];
      const release = current("wa_exchange_formularies", key)[0];
      const title = `Exchange plans: ${insurer.label}`;
      if (!release) return missing(`exchange_${key}`, title);
      const plans = exchangePlans.filter((p) => p.insurerKey === key).sort((a, b) => a.name.localeCompare(b.name) || a.planId.localeCompare(b.planId));
      const listings = exchangeDrugs.filter((d) => d.insurerKey === key).flatMap((d) => d.listings);
      return { key: `exchange_${key}`, title, state: "ok", rows: exchangeRows(match, plans, listings), note: null, provenance: [toProvenance(release)] };
    }),
    umpGroup(),
  ];

  const insulin = insulinKind(match);
  const copayRows = [
    ...partdCopayRows(
      match,
      partdPlans.map((p) => ({ ...p, deductible: p.deductible == null ? null : Number(p.deductible) })),
      partdRows,
      insulin,
    ),
    ...WA_INSURER_KEYS.flatMap((key) =>
      exchangeCopayRows(
        WA_EXCHANGE_INSURERS[key].label,
        exchangePlans.filter((p) => p.insurerKey === key),
        exchangeDrugs.filter((d) => d.insurerKey === key).flatMap((d) => d.listings),
        insulin,
      ),
    ),
  ];
  const copays = {
    rows: sortCopays(copayRows),
    provenance: [...(partdRelease && partdPlans.length ? [toProvenance(partdRelease)] : []), ...exchangeReleases.map((r) => toProvenance(r))],
    // Part D plan costs arrive with the quarterly Part D import; an import made before them leaves the table empty.
    partdLoaded: partdPlans.some((p) => p.tierCosts.length > 0),
    // Insurers whose current upload predates cost details (their plans have none).
    exchangeMissing: WA_INSURER_KEYS.filter((key) => {
      const plans = exchangePlans.filter((p) => p.insurerKey === key);
      return !plans.length || plans.every((p) => !Object.keys(p.costDetails).length);
    }).map((key) => WA_EXCHANGE_INSURERS[key].label),
    insulin,
  };

  const reference = nadacRelease
    ? { ...referencePrice(match, nadac.map((n) => ({ ...n, perUnit: Number(n.perUnit) }))), provenance: [toProvenance(nadacRelease)] }
    : null;
  return { query, lookup, groups, reference, copays };
}
