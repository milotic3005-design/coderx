/**
 * Washington formulary data built on the operator's Mac by scripts/refresh-wa-coverage.ts
 * (which runs the checker in wa-coverage-check/) and uploaded to POST /api/admin/wa-coverage:
 *
 *  - apple_health: the Apple Health (Medicaid) Preferred Drug List, one row per NDC (wa_hca_pdl).
 *  - exchange: one insurer's Washington exchange plans and drug listings (wa_exchange_formularies,
 *    one current release per insurer, period label = insurer key).
 *  - nadac: one week of NADAC per NDC (cms_nadac).
 *
 * Each upload replaces the current release in its scope and deletes the rows it replaced, so the
 * database holds one copy. The same data (same SHA-256) is skipped unless forced.
 */
import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { insertBatches, type Tx } from "./batch";
import { SOURCES, type SourceKey } from "./sources";

/** Insurers that publish Washington exchange plans in CMS's machine-readable format (checked 2026-11-13). */
export const WA_EXCHANGE_INSURERS = {
  ambetter: { label: "Ambetter", organization: "Ambetter (Centene)", hosts: ["api.centene.com"] },
  cambia: { label: "Regence/BridgeSpan", organization: "Regence and BridgeSpan (Cambia Health Solutions)", hosts: ["cms-machine-readable.cambiahealth.com"] },
} as const;
export type WaInsurerKey = keyof typeof WA_EXCHANGE_INSURERS;
export const WA_INSURER_KEYS = Object.keys(WA_EXCHANGE_INSURERS) as [WaInsurerKey, ...WaInsurerKey[]];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ndc11 = z.string().regex(/^\d{11}$/);
/** True for an https URL on one of `hosts`; false (never a throw) for anything else. */
const onHost = (u: string, hosts: readonly string[]) => {
  try {
    const url = new URL(u);
    return url.protocol === "https:" && hosts.includes(url.hostname);
  } catch {
    return false;
  }
};
const httpsOn = (hosts: readonly string[]) =>
  z
    .string()
    .url()
    .refine((u) => onHost(u, hosts), `The URL must be on ${hosts.join(" or ")}.`);
const common = {
  /** SHA-256 of the uploaded data, used to skip an identical upload. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().positive(),
  /** The publisher's date for the data, in its own words where possible. */
  asOf: z.string().min(1).max(300),
  lastModified: z.string().max(300).nullable(),
  force: z.boolean().default(false),
};
const code = z.string().max(8);

const appleHealthSchema = z.object({
  kind: z.literal("apple_health"),
  url: httpsOn(["www.hca.wa.gov"]),
  effectiveStart: isoDate,
  effectiveEnd: isoDate.nullable(),
  ...common,
  rows: z
    .array(
      z.object({
        ndc11,
        label: z.string().max(300),
        coverage: code,
        nonCoveredReason: code,
        pharmacyPreferred: code,
        pharmacyPa: code,
        medicalPreferred: code,
        medicalPa: code,
        paPolicy: z.string().max(60),
      }),
    )
    .min(1000)
    .max(200_000),
});

/** One cost_sharing entry as the insurer's file states it (CMS's QHP formulary schema). */
const costDetailSchema = z.object({
  pharmacyType: z.string().max(40),
  copayAmount: z.number().finite().nonnegative().nullable(),
  copayOpt: z.string().max(40).nullable(),
  coinsuranceRate: z.number().finite().min(0).max(1).nullable(),
  coinsuranceOpt: z.string().max(40).nullable(),
});
const listingSchema = z.object({ planId: z.string().max(20), tier: z.string().max(60), pa: z.boolean(), st: z.boolean(), ql: z.boolean() });
const exchangeSchema = z
  .object({
    kind: z.literal("exchange"),
    insurerKey: z.enum(WA_INSURER_KEYS),
    url: z.string().url(),
    planYear: z.number().int().min(2024).max(2100),
    ...common,
    plans: z
      .array(
        z.object({
          planId: z.string().regex(/^\d{5}WA\d{7}(-\d{2})?$/),
          name: z.string().min(1).max(300),
          costs: z.record(z.string().max(60), z.string().max(1000)),
          costDetails: z.record(z.string().max(60), z.array(costDetailSchema).max(20)),
        }),
      )
      .min(1)
      .max(300),
    drugs: z
      .array(z.object({ rxcui: z.string().regex(/^\d{1,10}$/), listings: z.array(listingSchema).min(1).max(1000) }))
      .min(100)
      .max(60_000),
  })
  .superRefine((u, ctx) => {
    const hosts = WA_EXCHANGE_INSURERS[u.insurerKey].hosts;
    if (!onHost(u.url, hosts)) ctx.addIssue({ code: "custom", path: ["url"], message: `The URL must be on ${hosts.join(" or ")}.` });
    const planIds = new Set(u.plans.map((p) => p.planId));
    const stray = u.drugs.find((d) => d.listings.some((l) => !planIds.has(l.planId)));
    if (stray) ctx.addIssue({ code: "custom", path: ["drugs"], message: `RxCUI ${stray.rxcui} lists a plan that is not in plans.` });
  });

const nadacSchema = z.object({
  kind: z.literal("nadac"),
  url: httpsOn(["data.medicaid.gov"]),
  weekOf: isoDate,
  ...common,
  rows: z
    .array(z.object({ ndc11, description: z.string().max(300), perUnit: z.number().finite().positive(), unit: z.string().max(8), effectiveDate: isoDate, classification: z.string().max(10) }))
    .min(1000)
    .max(100_000),
});

export const waUploadSchema = z.discriminatedUnion("kind", [appleHealthSchema, exchangeSchema, nadacSchema]);
export type WaUpload = z.input<typeof waUploadSchema>;
type Parsed = z.output<typeof waUploadSchema>;

/** Largest JSON body accepted once decompressed (the Apple Health PDL is about 20 MB). */
export const WA_UPLOAD_MAX_BYTES = 60_000_000;

interface Plan {
  sourceKey: SourceKey;
  /** One current release per (source, scope): the insurer for exchange files, the whole source otherwise. */
  scope: string | null;
  release: Omit<typeof t.sourceReleases.$inferInsert, "sourceKey" | "status" | "isCurrent" | "checksumSha256" | "byteSize" | "recordCount">;
  records: number;
  insert: (tx: Tx, releaseId: number) => Promise<void>;
  /** Deletes the rows of releases this upload replaces. */
  remove: (tx: Tx, releaseIds: number[]) => Promise<void>;
  details: Record<string, unknown>;
}

const fileName = (url: string) => decodeURIComponent(new URL(url).pathname.split("/").pop() || "") || null;
/** "Thu, 12 Nov 2026 17:50:21 GMT" -> "2026-11-12" */
const httpDate = (v: string | null) => {
  const ms = v ? Date.parse(v) : NaN;
  return Number.isNaN(ms) ? null : new Date(ms).toISOString().slice(0, 10);
};

function planFor(u: Parsed): Plan {
  if (u.kind === "apple_health") {
    const source = SOURCES.wa_hca_pdl;
    return {
      sourceKey: source.key,
      scope: null,
      release: {
        organization: source.organization,
        dataset: source.dataset,
        periodLabel: u.effectiveStart,
        fileName: fileName(u.url),
        downloadUrl: u.url,
        landingPageUrl: source.landingPageUrl,
        publicationDate: u.effectiveStart,
        // "Effective November 14, 2026 - November 20, 2026" reads as "Published weekly PDL, effective November 14, …".
        publicationLabel: `weekly PDL, ${u.asOf.charAt(0).toLowerCase()}${u.asOf.slice(1)}`,
        effectiveStart: u.effectiveStart,
        effectiveEnd: u.effectiveEnd,
      },
      records: u.rows.length,
      remove: async (tx, ids) => {
        await tx.delete(t.waPdlNdcs).where(inArray(t.waPdlNdcs.sourceReleaseId, ids));
      },
      insert: async (tx, id) => {
        await insertBatches(tx, t.waPdlNdcs, u.rows.map((r) => ({ ...r, sourceReleaseId: id })), 11);
      },
      details: { asOf: u.asOf, ndcs: u.rows.length, fileLastModified: u.lastModified },
    };
  }
  if (u.kind === "exchange") {
    const source = SOURCES.wa_exchange_formularies;
    const insurer = WA_EXCHANGE_INSURERS[u.insurerKey];
    return {
      sourceKey: source.key,
      scope: u.insurerKey,
      release: {
        organization: insurer.organization,
        dataset: `${source.dataset}: ${insurer.label}, plan year ${u.planYear}`,
        periodLabel: u.insurerKey,
        fileName: fileName(u.url),
        downloadUrl: u.url,
        landingPageUrl: source.landingPageUrl,
        publicationDate: httpDate(u.lastModified),
        publicationLabel: u.asOf,
        effectiveStart: `${u.planYear}-01-01`,
        effectiveEnd: `${u.planYear}-12-31`,
      },
      records: u.drugs.length,
      remove: async (tx, ids) => {
        await tx.delete(t.waExchangePlans).where(inArray(t.waExchangePlans.sourceReleaseId, ids));
        await tx.delete(t.waExchangeDrugs).where(inArray(t.waExchangeDrugs.sourceReleaseId, ids));
      },
      insert: async (tx, id) => {
        await insertBatches(tx, t.waExchangePlans, u.plans.map((p) => ({ insurerKey: u.insurerKey, planId: p.planId, name: p.name, costs: p.costs, costDetails: p.costDetails, sourceReleaseId: id })), 7);
        await insertBatches(tx, t.waExchangeDrugs, u.drugs.map((d) => ({ insurerKey: u.insurerKey, rxcui: d.rxcui, listings: d.listings, sourceReleaseId: id })), 5);
      },
      details: { asOf: u.asOf, insurer: insurer.label, planYear: u.planYear, plans: u.plans.length, rxcuis: u.drugs.length, listings: u.drugs.reduce((n, d) => n + d.listings.length, 0), fileLastModified: u.lastModified },
    };
  }
  const source = SOURCES.cms_nadac;
  return {
    sourceKey: source.key,
    scope: null,
    release: {
      organization: source.organization,
      dataset: source.dataset,
      periodLabel: u.weekOf,
      fileName: null,
      downloadUrl: u.url,
      landingPageUrl: source.landingPageUrl,
      publicationDate: u.weekOf,
      publicationLabel: u.asOf,
      effectiveStart: u.weekOf,
      effectiveEnd: null,
    },
    records: u.rows.length,
    remove: async (tx, ids) => {
      await tx.delete(t.nadacPrices).where(inArray(t.nadacPrices.sourceReleaseId, ids));
    },
    insert: async (tx, id) => {
      await insertBatches(tx, t.nadacPrices, u.rows.map((r) => ({ ...r, perUnit: String(r.perUnit), sourceReleaseId: id })), 8);
    },
    details: { asOf: u.asOf, ndcs: u.rows.length },
  };
}

export async function importWaUpload(db: Database, upload: Parsed): Promise<{ status: "imported" | "skipped"; sourceKey: SourceKey; releaseId: number; records: number }> {
  const plan = planFor(upload);
  const inScope = (sha?: string) =>
    and(eq(t.sourceReleases.sourceKey, plan.sourceKey), plan.scope ? eq(t.sourceReleases.periodLabel, plan.scope) : undefined, sha ? eq(t.sourceReleases.checksumSha256, sha) : undefined);

  // Skip only when this data is what the site serves now; the same data seen earlier and since replaced is imported again.
  const same = await db.select({ id: t.sourceReleases.id }).from(t.sourceReleases).where(and(inScope(upload.sha256), eq(t.sourceReleases.status, "succeeded")));
  if (same.length && !upload.force) return { status: "skipped", sourceKey: plan.sourceKey, releaseId: same[0].id, records: plan.records };

  const releaseId = await db.transaction(async (tx) => {
    // A forced re-upload of the same data would collide with the unique (source, period, checksum) index.
    if (same.length) await tx.update(t.sourceReleases).set({ status: "superseded", isCurrent: false }).where(inArray(t.sourceReleases.id, same.map((s) => s.id)));
    const [release] = await tx
      .insert(t.sourceReleases)
      .values({ ...plan.release, sourceKey: plan.sourceKey, checksumSha256: upload.sha256, byteSize: upload.bytes, recordCount: plan.records, status: "processing", isCurrent: false })
      .returning({ id: t.sourceReleases.id });
    await plan.insert(tx, release.id);

    // Retire every older release in scope and delete its rows: only the current week or file is served.
    const older = await tx.select({ id: t.sourceReleases.id }).from(t.sourceReleases).where(and(inScope(), ne(t.sourceReleases.id, release.id), ne(t.sourceReleases.status, "failed")));
    const olderIds = older.map((o) => o.id);
    if (olderIds.length) {
      await plan.remove(tx, olderIds);
      await tx.update(t.sourceReleases).set({ status: "superseded", isCurrent: false }).where(inArray(t.sourceReleases.id, olderIds));
    }
    await tx.update(t.sourceReleases).set({ status: "succeeded", isCurrent: true, report: { details: plan.details } }).where(eq(t.sourceReleases.id, release.id));
    return release.id;
  });
  return { status: "imported", sourceKey: plan.sourceKey, releaseId, records: plan.records };
}
