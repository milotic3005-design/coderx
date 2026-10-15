/**
 * Import pipeline: download → integrity → parse → validate → transactional load →
 * derive → report. A failure anywhere inside the transaction rolls everything
 * back; the failure itself is then recorded as a `failed` release.
 */
import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { insertBatches } from "./batch";
import { deriveAll, type DeriveReport } from "./derive";
import { download, type DownloadOptions, type Downloaded } from "./fetch";
import { CROSSWALK_LABELS, crosswalkTypeFromFileName, parseCrosswalkCsv, type CrosswalkFile } from "./parsers/cms-crosswalk";
import { parseNotPayableCsv, parsePaymentLimitCsv } from "./parsers/cms-payment";
import { parseFdaPackages, parseFdaProducts, parsePurpleBookCsv, type FdaPackage, type FdaProduct } from "./parsers/fda";
import { parseHcpcsFixedWidth, parseNocCodeRows, type Rejected } from "./parsers/hcpcs";
import { isClinicianAdministeredProduct } from "./scope";
import { SOURCES, type ReleaseCandidate, type SourceKey } from "./sources";
import { decodeText } from "./text-decode";
import { parseHttpDate, quarterBounds } from "./values";
import { readFirstSheet } from "./xlsx";
import { baseName, unzipVerified } from "./zip";

export type Fetcher = (url: string) => Promise<Downloaded>;

export interface ImportOptions {
  /** Re-import even when the same file (checksum) was already imported. */
  force?: boolean;
  /** Skip the derive step (callers that import several sources derive once at the end). */
  skipDerive?: boolean;
  download?: DownloadOptions;
  /** Injected for tests and offline runs. */
  fetcher?: Fetcher;
  /**
   * "strict" (default) enforces production-size plausibility checks (e.g. at least
   * 5,000 HCPCS codes). "relaxed" keeps every structural check but skips record-count
   * minimums; it exists for fixture-based tests only.
   */
  plausibility?: "strict" | "relaxed";
  log?: (message: string) => void;
}

export interface ImportOutcome {
  sourceKey: SourceKey;
  period: string | null;
  url: string;
  status: "imported" | "skipped" | "failed";
  releaseId?: number;
  reason?: string;
  report?: ImportReport;
}

export interface ImportReport {
  fileName: string | null;
  encoding?: string;
  recordCount: number;
  rejected: number;
  rejectedSamples: Rejected[];
  excluded?: Record<string, number>;
  diff?: Record<string, unknown>;
  details?: Record<string, unknown>;
  derive?: DeriveReport;
  warnings: string[];
  durationMs: number;
}

class ValidationError extends Error {}

let relaxedChecks = false;

/** Record-count sanity checks that catch truncated or wrong files in production. */
function assertPlausible(condition: boolean, message: string) {
  if (!condition && !relaxedChecks) throw new ValidationError(message);
}

/* ------------------------------------------------------------------ */
/* Parsing per source (pure — no database writes)                      */
/* ------------------------------------------------------------------ */

interface Parsed {
  fileName: string | null;
  encoding?: string;
  effectiveStart: string | null;
  effectiveEnd: string | null;
  recordCount: number;
  rejected: Rejected[];
  excluded?: Record<string, number>;
  warnings: string[];
  details?: Record<string, unknown>;
  load: (tx: Database, releaseId: number, period: string) => Promise<Record<string, unknown> | undefined>;
}

function parseHcpcsRelease(file: Downloaded, period: string): Parsed {
  const entries = unzipVerified(file.bytes, (n) => /HCPC\d{4}_[A-Z]{3}_ANWEB.*\.txt$/i.test(baseName(n)) || /noc codes.*\.xlsx$/i.test(baseName(n)));
  const txt = entries.find((e) => e.name.toLowerCase().endsWith(".txt"));
  if (!txt) throw new ValidationError("HCPCS archive: alpha-numeric TXT file not found.");
  const decoded = decodeText(txt.data);
  const parsed = parseHcpcsFixedWidth(decoded.text);
  assertPlausible(parsed.records.length >= 5000, `HCPCS file has only ${parsed.records.length} codes; expected at least 5,000.`);
  const nocEntry = entries.find((e) => e.name.toLowerCase().endsWith(".xlsx"));
  const noc = nocEntry ? parseNocCodeRows(readFirstSheet(nocEntry.data)) : null;
  const warnings: string[] = [];
  if (!noc) warnings.push("NOC code list not found in archive; is_noc left false for this quarter.");
  const { start, end } = quarterBounds(period);
  return {
    fileName: baseName(txt.name),
    encoding: decoded.encoding,
    effectiveStart: start,
    effectiveEnd: end,
    recordCount: parsed.records.length,
    rejected: parsed.rejected,
    excluded: { cdtCodes: parsed.excludedCdt, modifierLines: parsed.modifierLines },
    warnings,
    details: { nocCodes: noc?.codes.size ?? 0 },
    load: async (tx, releaseId) => {
      await tx.delete(t.hcpcsSnapshots).where(eq(t.hcpcsSnapshots.period, period));
      await insertBatches(
        tx,
        t.hcpcsSnapshots,
        parsed.records.map((r) => ({
          period,
          sourceReleaseId: releaseId,
          code: r.code,
          shortDescription: r.shortDescription,
          longDescription: r.longDescription,
          pricingIndicators: r.pricingIndicators,
          multiplePricingIndicator: r.multiplePricingIndicator,
          coverageCode: r.coverageCode,
          betos: r.betos,
          typeOfService: r.typeOfService,
          crossReferences: r.crossReferences,
          processingNote: r.processingNote,
          addedDate: r.addedDate,
          actionEffectiveDate: r.actionEffectiveDate,
          terminationDate: r.terminationDate,
          actionCode: r.actionCode,
          isNoc: noc?.codes.has(r.code) ?? false,
        })),
        18,
      );
      const actions: Record<string, number> = {};
      for (const r of parsed.records) if (r.actionCode) actions[r.actionCode] = (actions[r.actionCode] ?? 0) + 1;
      return { actionCodes: actions, terminatedCodes: parsed.records.filter((r) => r.terminationDate).length };
    },
  };
}

function parsePaymentRelease(file: Downloaded, period: string): Parsed {
  const entries = unzipVerified(file.bytes, (n) => n.toLowerCase().endsWith(".csv"));
  const limitEntry = entries.find((e) => /(payment limit file|asp pricing file)/i.test(baseName(e.name)) && !/not payable/i.test(e.name));
  if (!limitEntry) throw new ValidationError("Payment limit archive: Section 508 CSV not found.");
  const decoded = decodeText(limitEntry.data);
  const parsed = parsePaymentLimitCsv(decoded.text);
  assertPlausible(parsed.rows.length >= 300, `Payment limit file has only ${parsed.rows.length} HCPCS rows; expected at least 300.`);
  const notPayableEntry = entries.find((e) => /not payable/i.test(baseName(e.name)));
  const notPayable = notPayableEntry ? parseNotPayableCsv(decodeText(notPayableEntry.data).text) : null;
  const bounds = quarterBounds(period);
  const warnings: string[] = [];
  if (parsed.effectiveStart && parsed.effectiveStart !== bounds.start) {
    warnings.push(`File states effective ${parsed.effectiveStart}–${parsed.effectiveEnd}; manifest period ${period} starts ${bounds.start}.`);
  }
  const effectiveStart = parsed.effectiveStart ?? bounds.start;
  const effectiveEnd = parsed.effectiveEnd ?? bounds.end;
  return {
    fileName: baseName(limitEntry.name),
    encoding: decoded.encoding,
    effectiveStart,
    effectiveEnd,
    recordCount: parsed.rows.length,
    rejected: parsed.rejected,
    excluded: { cptRows: parsed.excludedCpt },
    warnings,
    details: { aspDataPeriod: parsed.aspDataPeriod, notPayableRows: notPayable?.rows.length ?? 0 },
    load: async (tx, releaseId) => {
      // Revision tracking: compare with the release currently serving this quarter.
      const previous = await tx
        .select({ code: t.paymentLimits.hcpcsCode, limit: t.paymentLimits.paymentLimit })
        .from(t.paymentLimits)
        .innerJoin(t.sourceReleases, eq(t.sourceReleases.id, t.paymentLimits.sourceReleaseId))
        .where(and(eq(t.paymentLimits.period, period), eq(t.sourceReleases.isCurrent, true)));
      const prevMap = new Map(previous.map((p) => [p.code, p.limit]));
      let changed = 0;
      let added = 0;
      for (const r of parsed.rows) {
        if (!prevMap.has(r.hcpcsCode)) added++;
        else if (Number(prevMap.get(r.hcpcsCode)) !== Number(r.paymentLimit)) changed++;
      }
      const removed = previous.length ? [...prevMap.keys()].filter((c) => !parsed.rows.some((r) => r.hcpcsCode === c)).length : 0;
      await insertBatches(
        tx,
        t.paymentLimits,
        parsed.rows.map((r) => ({
          hcpcsCode: r.hcpcsCode,
          period,
          effectiveStart,
          effectiveEnd,
          sourceReleaseId: releaseId,
          shortDescription: r.shortDescription,
          dosageDescriptor: r.dosageDescriptor,
          paymentLimit: r.paymentLimit,
          paymentLimitText: r.paymentLimitText,
          coinsurancePct: r.coinsurancePct,
          vaccineAwpPct: r.vaccineAwpPct,
          vaccineLimit: r.vaccineLimit,
          bloodAwpPct: r.bloodAwpPct,
          bloodLimit: r.bloodLimit,
          clottingFactor: r.clottingFactor,
          notes: r.notes,
          aspDataPeriod: parsed.aspDataPeriod,
          methodology: r.methodology,
        })),
        19,
      );
      if (notPayable) {
        await insertBatches(
          tx,
          t.partBNotPayable,
          notPayable.rows.map((r) => ({ hcpcsCode: r.hcpcsCode, period, sourceReleaseId: releaseId, description: r.description, manufacturer: r.manufacturer })),
          5,
        );
      }
      return previous.length ? { revisionOfExistingQuarter: true, changedLimits: changed, addedCodes: added, removedCodes: removed } : { revisionOfExistingQuarter: false };
    },
  };
}

function parseCrosswalkRelease(file: Downloaded, period: string): Parsed {
  const entries = unzipVerified(file.bytes, (n) => crosswalkTypeFromFileName(baseName(n)) !== null);
  const files: CrosswalkFile[] = [];
  const names: string[] = [];
  for (const e of entries) {
    const type = crosswalkTypeFromFileName(baseName(e.name))!;
    if (files.some((f) => f.type === type)) continue;
    files.push(parseCrosswalkCsv(decodeText(e.data).text, type));
    names.push(baseName(e.name));
  }
  const asp = files.find((f) => f.type === "ASP");
  if (!asp) throw new ValidationError("Crosswalk archive: ASP NDC-HCPCS crosswalk CSV not found.");
  assertPlausible(asp!.rows.length >= 3000, `ASP crosswalk has only ${asp!.rows.length} rows; expected at least 3,000.`);
  const bounds = quarterBounds(period);
  const effectiveStart = asp!.effectiveStart ?? bounds.start;
  const effectiveEnd = asp!.effectiveEnd ?? bounds.end;
  const warnings: string[] = [];
  if (asp!.effectiveStart && asp!.effectiveStart !== bounds.start) warnings.push(`ASP crosswalk states effective ${asp!.effectiveStart}; period ${period} starts ${bounds.start}.`);
  return {
    fileName: names.join("; "),
    effectiveStart,
    effectiveEnd,
    recordCount: files.reduce((n, f) => n + f.rows.length, 0),
    rejected: files.flatMap((f) => f.rejected),
    excluded: { cptRows: files.reduce((n, f) => n + f.excludedCpt, 0) },
    warnings,
    details: Object.fromEntries(files.map((f) => [CROSSWALK_LABELS[f.type], { rows: f.rows.length, alternateIds: f.alternateIds }])),
    load: async (tx, releaseId) => {
      const previous = await tx
        .select({ key: sql<string>`${t.ndcHcpcsCrosswalk.crosswalkType} || '|' || coalesce(${t.ndcHcpcsCrosswalk.hcpcsCode}, '') || '|' || ${t.ndcHcpcsCrosswalk.ndcRaw}` })
        .from(t.ndcHcpcsCrosswalk)
        .where(eq(t.ndcHcpcsCrosswalk.period, period));
      const prevKeys = new Set(previous.map((p) => p.key));
      await tx.delete(t.ndcHcpcsCrosswalk).where(eq(t.ndcHcpcsCrosswalk.period, period));
      const rows = files.flatMap((f) =>
        f.rows.map((r) => ({
          sourceReleaseId: releaseId,
          period,
          effectiveStart: f.effectiveStart ?? effectiveStart,
          effectiveEnd: f.effectiveEnd ?? effectiveEnd,
          ...r,
        })),
      );
      await insertBatches(tx, t.ndcHcpcsCrosswalk, rows, 18);
      if (!prevKeys.size) return { revisionOfExistingQuarter: false };
      const newKeys = new Set(rows.map((r) => `${r.crosswalkType}|${r.hcpcsCode ?? ""}|${r.ndcRaw}`));
      return {
        revisionOfExistingQuarter: true,
        addedRows: [...newKeys].filter((k) => !prevKeys.has(k)).length,
        removedRows: [...prevKeys].filter((k) => !newKeys.has(k)).length,
      };
    },
  };
}

async function crosswalkNdcSet(tx: Database): Promise<Set<string>> {
  const rows = await tx.selectDistinct({ ndc11: t.ndcHcpcsCrosswalk.ndc11 }).from(t.ndcHcpcsCrosswalk).where(isNotNull(t.ndcHcpcsCrosswalk.ndc11));
  return new Set(rows.map((r) => r.ndc11!));
}

function productRow(p: FdaProduct, releaseId: number, listingStatus: "listed" | "excluded") {
  return {
    productId: p.productId,
    productNdc: p.productNdc,
    productNdc9: p.productNdc9,
    productType: p.productType,
    proprietaryName: p.proprietaryName,
    proprietaryNameSuffix: p.proprietaryNameSuffix,
    nonproprietaryName: p.nonproprietaryName,
    dosageForm: p.dosageForm,
    routes: p.routes,
    marketingStart: p.marketingStart,
    marketingEnd: p.marketingEnd,
    marketingCategory: p.marketingCategory,
    applicationNumber: p.applicationNumber,
    labelerName: p.labelerName,
    substances: p.substances,
    strengths: p.strengths,
    strengthUnits: p.strengthUnits,
    pharmClasses: p.pharmClasses,
    deaSchedule: p.deaSchedule,
    listingCertifiedThrough: p.listingCertifiedThrough,
    listingStatus,
    excludeFlag: p.excludeFlag,
    sourceReleaseId: releaseId,
  };
}

function packageRow(k: FdaPackage, releaseId: number, listingStatus: "listed" | "excluded") {
  return {
    ndc11: k.ndc11,
    packageNdc: k.packageNdc,
    productId: k.productId,
    description: k.description,
    marketingStart: k.marketingStart,
    marketingEnd: k.marketingEnd,
    sample: k.sample,
    listingStatus,
    excludeFlag: k.excludeFlag,
    sourceReleaseId: releaseId,
  };
}

async function insertPackages(tx: Database, rows: ReturnType<typeof packageRow>[]) {
  const size = 2000;
  for (let i = 0; i < rows.length; i += size) {
    await tx.insert(t.ndcPackages).values(rows.slice(i, i + size)).onConflictDoNothing();
  }
}

function countRecords(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  if (text.length && text.charCodeAt(text.length - 1) !== 10) n++;
  return Math.max(0, n - 1); // minus the header line
}

/**
 * FDA files are large (70–90 MB of text). Records are filtered while parsing so only
 * the in-scope products and packages are ever materialized — important inside
 * memory-limited serverless functions.
 */
function parseFdaNdcRelease(file: Downloaded): Parsed {
  const entries = unzipVerified(file.bytes, (n) => /^(product|package)\.txt$/i.test(baseName(n)));
  const prodEntry = entries.find((e) => /product\.txt$/i.test(e.name));
  const pkgEntry = entries.find((e) => /package\.txt$/i.test(e.name));
  if (!prodEntry || !pkgEntry) throw new ValidationError("FDA NDC archive: product.txt or package.txt missing.");
  const prodText = decodeText(prodEntry.data);
  const pkgText = decodeText(pkgEntry.data);
  const productLines = countRecords(prodText.text);
  const packageLines = countRecords(pkgText.text);
  assertPlausible(productLines >= 50_000, `FDA product file has only ${productLines} rows; expected at least 50,000.`);
  assertPlausible(packageLines >= 100_000, `FDA package file has only ${packageLines} rows; expected at least 100,000.`);
  return {
    fileName: "product.txt; package.txt",
    encoding: `product.txt ${prodText.encoding}; package.txt ${pkgText.encoding}`,
    effectiveStart: null,
    effectiveEnd: null,
    recordCount: productLines + packageLines,
    rejected: [],
    warnings: [],
    load: async (tx, releaseId) => {
      const xw = await crosswalkNdcSet(tx);
      const allPackages = parseFdaPackages(pkgText.text);
      const crosswalkedProducts = new Set(allPackages.packages.filter((k) => xw.has(k.ndc11)).map((k) => k.productId));
      const parsedProducts = parseFdaProducts(prodText.text, (p) => isClinicianAdministeredProduct(p) || crosswalkedProducts.has(p.productId));
      const products = parsedProducts.products;
      const productIds = new Set(products.map((p) => p.productId));
      const packages = allPackages.packages.filter((k) => productIds.has(k.productId));
      assertPlausible(products.length >= 1000, `Only ${products.length} FDA products are in scope; expected at least 1,000.`);
      await tx.delete(t.ndcPackages).where(eq(t.ndcPackages.listingStatus, "listed"));
      await tx.delete(t.ndcProducts).where(eq(t.ndcProducts.listingStatus, "listed"));
      // An NDC that returned to the active directory supersedes its excluded record.
      const listedNdcs = packages.map((k) => k.ndc11);
      for (let i = 0; i < listedNdcs.length; i += 5000) {
        await tx.delete(t.ndcPackages).where(and(eq(t.ndcPackages.listingStatus, "excluded"), inArray(t.ndcPackages.ndc11, listedNdcs.slice(i, i + 5000))));
      }
      const listedIds = [...productIds];
      for (let i = 0; i < listedIds.length; i += 5000) {
        await tx.delete(t.ndcProducts).where(inArray(t.ndcProducts.productId, listedIds.slice(i, i + 5000)));
      }
      await insertBatches(tx, t.ndcProducts, products.map((p) => productRow(p, releaseId, "listed")), 24);
      await insertPackages(tx, packages.map((k) => packageRow(k, releaseId, "listed")));
      const rejected = [...parsedProducts.rejected, ...allPackages.rejected];
      return {
        productsInScope: products.length,
        packagesInScope: packages.length,
        crosswalkedProductsIncluded: crosswalkedProducts.size,
        rejectedRecords: rejected.length,
        rejectedSamples: rejected.slice(0, 10),
      };
    },
  };
}

function parseFdaExcludedRelease(file: Downloaded): Parsed {
  const entries = unzipVerified(file.bytes, (n) => /^(products|packages)_excluded\.txt$/i.test(baseName(n)));
  const prodEntry = entries.find((e) => /products_excluded\.txt$/i.test(e.name));
  const pkgEntry = entries.find((e) => /packages_excluded\.txt$/i.test(e.name));
  if (!prodEntry || !pkgEntry) throw new ValidationError("FDA excluded archive: Products_excluded.txt or Packages_excluded.txt missing.");
  const pkgText = decodeText(pkgEntry.data);
  const prodText = decodeText(prodEntry.data);
  const productLines = countRecords(prodText.text);
  const packageLines = countRecords(pkgText.text);
  assertPlausible(productLines >= 10_000, `FDA excluded product file has only ${productLines} rows.`);
  return {
    fileName: "Products_excluded.txt; Packages_excluded.txt",
    encoding: `Products ${prodText.encoding}; Packages ${pkgText.encoding}`,
    effectiveStart: null,
    effectiveEnd: null,
    recordCount: productLines + packageLines,
    rejected: [],
    warnings: [],
    load: async (tx, releaseId) => {
      const xw = await crosswalkNdcSet(tx);
      const listed = new Set(
        (await tx.select({ ndc11: t.ndcPackages.ndc11 }).from(t.ndcPackages).where(eq(t.ndcPackages.listingStatus, "listed"))).map((r) => r.ndc11),
      );
      const listedProductIds = new Set(
        (await tx.select({ id: t.ndcProducts.productId }).from(t.ndcProducts).where(eq(t.ndcProducts.listingStatus, "listed"))).map((r) => r.id),
      );
      const parsedPackages = parseFdaPackages(pkgText.text, (k) => xw.has(k.ndc11) && !listed.has(k.ndc11));
      const packages = parsedPackages.packages;
      const productIds = new Set(packages.map((k) => k.productId));
      const parsedProducts = parseFdaProducts(prodText.text, (p) => productIds.has(p.productId) && !listedProductIds.has(p.productId));
      const products = parsedProducts.products;
      await tx.delete(t.ndcPackages).where(eq(t.ndcPackages.listingStatus, "excluded"));
      await tx.delete(t.ndcProducts).where(eq(t.ndcProducts.listingStatus, "excluded"));
      await insertBatches(tx, t.ndcProducts, products.map((p) => productRow(p, releaseId, "excluded")), 24);
      await insertPackages(tx, packages.map((k) => packageRow(k, releaseId, "excluded")));
      const flags: Record<string, number> = {};
      for (const k of packages) flags[k.excludeFlag ?? "?"] = (flags[k.excludeFlag ?? "?"] ?? 0) + 1;
      const rejected = [...parsedPackages.rejected, ...parsedProducts.rejected];
      return {
        crosswalkedExcludedPackages: packages.length,
        products: products.length,
        excludeFlags: flags,
        rejectedRecords: rejected.length,
        rejectedSamples: rejected.slice(0, 10),
      };
    },
  };
}

function parsePurpleBookRelease(file: Downloaded): Parsed {
  const decoded = decodeText(file.bytes);
  const parsed = parsePurpleBookCsv(decoded.text);
  assertPlausible(parsed.rows.length >= 1000, `Purple Book file has only ${parsed.rows.length} product rows; expected at least 1,000.`);
  return {
    fileName: baseName(new URL(file.url).pathname),
    encoding: decoded.encoding,
    effectiveStart: null,
    effectiveEnd: null,
    recordCount: parsed.rows.length,
    rejected: [],
    warnings: [],
    details: { reportTitle: parsed.reportTitle, biosimilarRows: parsed.rows.filter((r) => r.licenseType?.startsWith("351(k)")).length },
    load: async (tx, releaseId) => {
      await tx.delete(t.biologicProducts);
      await insertBatches(tx, t.biologicProducts, parsed.rows.map((r) => ({ ...r, sourceReleaseId: releaseId })), 19);
      return undefined;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                       */
/* ------------------------------------------------------------------ */

function resolvePeriod(candidate: ReleaseCandidate, file: Downloaded): string {
  if (candidate.period) return candidate.period;
  return parseHttpDate(file.lastModified) ?? new Date().toISOString().slice(0, 10);
}

async function recordFailure(db: Database, candidate: ReleaseCandidate, period: string | null, file: Downloaded | null, error: unknown) {
  const source = SOURCES[candidate.sourceKey];
  const message = error instanceof Error ? error.message : String(error);
  const [row] = await db
    .insert(t.sourceReleases)
    .values({
      sourceKey: candidate.sourceKey,
      organization: source.organization,
      dataset: source.dataset,
      periodLabel: period,
      downloadUrl: candidate.url,
      landingPageUrl: source.landingPageUrl,
      publicationDate: candidate.publicationDate ?? parseHttpDate(file?.lastModified ?? null),
      publicationLabel: candidate.publicationLabel ?? null,
      checksumSha256: file?.sha256 ?? null,
      byteSize: file?.byteSize ?? null,
      status: "failed",
      isCurrent: false,
      error: message.slice(0, 2000),
    })
    .returning({ id: t.sourceReleases.id });
  return row.id;
}

export async function importRelease(db: Database, candidate: ReleaseCandidate, options: ImportOptions = {}): Promise<ImportOutcome> {
  const log = options.log ?? (() => {});
  const started = Date.now();
  const source = SOURCES[candidate.sourceKey];
  let file: Downloaded | null = null;
  let period: string | null = candidate.period;

  try {
    log(`${candidate.sourceKey} ${candidate.period ?? ""}: downloading ${candidate.url}`);
    file = options.fetcher ? await options.fetcher(candidate.url) : await download(candidate.url, options.download);
    period = resolvePeriod(candidate, file);

    const existing = await db
      .select({ id: t.sourceReleases.id })
      .from(t.sourceReleases)
      .where(
        and(
          eq(t.sourceReleases.sourceKey, candidate.sourceKey),
          eq(t.sourceReleases.periodLabel, period),
          eq(t.sourceReleases.checksumSha256, file.sha256),
          ne(t.sourceReleases.status, "failed"),
        ),
      );
    if (existing.length && !options.force) {
      log(`${candidate.sourceKey} ${period}: unchanged (checksum ${file.sha256.slice(0, 12)}…) — skipped`);
      return { sourceKey: candidate.sourceKey, period, url: candidate.url, status: "skipped", releaseId: existing[0].id, reason: "Same file already imported" };
    }

    log(`${candidate.sourceKey} ${period}: parsing ${file.byteSize.toLocaleString()} bytes`);
    relaxedChecks = options.plausibility === "relaxed";
    let parsed: Parsed;
    switch (candidate.sourceKey) {
      case "cms_hcpcs":
        parsed = parseHcpcsRelease(file, period);
        break;
      case "cms_payment_limits":
        parsed = parsePaymentRelease(file, period);
        break;
      case "cms_ndc_hcpcs":
        parsed = parseCrosswalkRelease(file, period);
        break;
      case "fda_ndc":
        parsed = parseFdaNdcRelease(file);
        break;
      case "fda_ndc_excluded":
        parsed = parseFdaExcludedRelease(file);
        break;
      case "fda_purple_book":
        parsed = parsePurpleBookRelease(file);
        break;
      default:
        throw new Error(`Unknown source ${String(candidate.sourceKey)}`);
    }

    const releasePeriod = period;
    const result = await db.transaction(async (tx) => {
      if (existing.length && options.force) {
        // Re-importing the identical file: retire the old row so the checksum stays unique.
        await tx.update(t.sourceReleases).set({ status: "superseded", isCurrent: false }).where(inArray(t.sourceReleases.id, existing.map((e) => e.id)));
      }
      const [release] = await tx
        .insert(t.sourceReleases)
        .values({
          sourceKey: candidate.sourceKey,
          organization: source.organization,
          dataset: source.dataset,
          periodLabel: releasePeriod,
          fileName: parsed.fileName,
          downloadUrl: candidate.url,
          landingPageUrl: source.landingPageUrl,
          publicationDate: candidate.publicationDate ?? parseHttpDate(file!.lastModified),
          publicationLabel: candidate.publicationLabel ?? (file!.lastModified ? `Last-Modified ${file!.lastModified}` : null),
          effectiveStart: parsed.effectiveStart,
          effectiveEnd: parsed.effectiveEnd,
          checksumSha256: file!.sha256,
          byteSize: file!.byteSize,
          recordCount: parsed.recordCount,
          status: "processing",
          isCurrent: false,
        })
        .returning({ id: t.sourceReleases.id });

      const diff = await parsed.load(tx, release.id, releasePeriod);

      // Supersede earlier releases: per quarter/month for periodic sources, all prior snapshots for daily FDA files.
      const periodic = source.cadence !== "daily";
      await tx
        .update(t.sourceReleases)
        .set({ isCurrent: false, status: "superseded" })
        .where(
          and(
            eq(t.sourceReleases.sourceKey, candidate.sourceKey),
            eq(t.sourceReleases.isCurrent, true),
            ne(t.sourceReleases.id, release.id),
            ...(periodic ? [eq(t.sourceReleases.periodLabel, releasePeriod)] : []),
          ),
        );
      await tx.update(t.sourceReleases).set({ isCurrent: true }).where(eq(t.sourceReleases.id, release.id));

      let derive: DeriveReport | undefined;
      if (!options.skipDerive) derive = await deriveAll(tx, log);

      const report: ImportReport = {
        fileName: parsed.fileName,
        encoding: parsed.encoding,
        recordCount: parsed.recordCount,
        rejected: parsed.rejected.length,
        rejectedSamples: parsed.rejected.slice(0, 20),
        excluded: parsed.excluded,
        diff,
        details: parsed.details,
        derive,
        warnings: [...parsed.warnings, ...(derive?.warnings ?? [])],
        durationMs: Date.now() - started,
      };
      await tx.update(t.sourceReleases).set({ status: "succeeded", report }).where(eq(t.sourceReleases.id, release.id));
      return { releaseId: release.id, report };
    });

    log(`${candidate.sourceKey} ${period}: imported release #${result.releaseId} (${parsed.recordCount.toLocaleString()} records, ${result.report.durationMs} ms)`);
    return { sourceKey: candidate.sourceKey, period, url: candidate.url, status: "imported", releaseId: result.releaseId, report: result.report };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`${candidate.sourceKey} ${period ?? ""}: FAILED — ${message}`);
    let releaseId: number | undefined;
    try {
      releaseId = await recordFailure(db, candidate, period, file, error);
    } catch {
      // Recording the failure must never mask the original error.
    }
    return { sourceKey: candidate.sourceKey, period, url: candidate.url, status: "failed", releaseId, reason: message };
  }
}

/** Rebuild derived tables on their own (e.g. after a batch import with skipDerive). */
export async function runDerive(db: Database, log?: (m: string) => void): Promise<DeriveReport> {
  return db.transaction((tx) => deriveAll(tx, log));
}

export const IMPORT_ORDER: SourceKey[] = ["cms_hcpcs", "cms_payment_limits", "cms_ndc_hcpcs", "fda_ndc", "fda_ndc_excluded", "fda_purple_book"];
