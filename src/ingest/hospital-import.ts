/**
 * Import one hospital's anonymized drug rates (built by scripts/refresh-price-benchmark.ts)
 * as a release of hpt_multicare: one current release per hospital (period label = hospital
 * key), skipped when the same file (SHA-256) is already imported unless forced.
 */
import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { insertBatches } from "./batch";
import { HOSPITAL_FILE_HOSTS, hospitalByKey, MULTICARE_PAGE } from "./hospitals";
import { DRUG_HCPCS_RE } from "./parsers/hospital-mrf";
import { SOURCES } from "./sources";

const money = z.number().finite().nonnegative().nullable();
const groupSchema = z.object({
  code: z.string().regex(DRUG_HCPCS_RE),
  planType: z.enum(["commercial", "medicare_advantage", "medicaid_managed_care"]),
  setting: z.string().max(40),
  billingClass: z.string().max(40),
  methodology: z.string().max(80),
  drugQuantity: z.number().finite().positive().nullable(),
  drugUnit: z.string().max(8).nullable(),
  amounts: z.array(z.number().finite().nonnegative()).max(1000),
  percentContracts: z.number().int().min(0),
  algorithmContracts: z.number().int().min(0),
  grossMin: money,
  grossMax: money,
  cashMin: money,
  cashMax: money,
});

export const hospitalRatesSchema = z.object({
  hospitalKey: z.string().refine((k) => !!hospitalByKey(k), "Unknown hospital key."),
  file: z.object({
    url: z
      .string()
      .url()
      .refine((u) => u.startsWith("https://") && HOSPITAL_FILE_HOSTS.includes(new URL(u).hostname), "The file URL must be on the hospital's file host."),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    bytes: z.number().int().positive(),
    lastModified: z.string().max(80).nullable(),
  }),
  meta: z.object({
    hospitalName: z.string().max(200).nullable(),
    lastUpdatedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    version: z.string().max(20).nullable(),
    locationNames: z.array(z.string().max(200)).max(50),
    addresses: z.array(z.string().max(300)).max(50),
    license: z.string().max(80).nullable(),
    npis: z.array(z.string().regex(/^\d{10}$/)).max(50),
  }),
  stats: z.object({ rowsRead: z.number().int().min(0), drugRows: z.number().int().min(0), contracts: z.number().int().min(0) }),
  groups: z.array(groupSchema).min(1).max(60_000),
  force: z.boolean().default(false),
});

export type HospitalRatesUpload = z.input<typeof hospitalRatesSchema>;

export async function importHospitalRates(db: Database, upload: z.output<typeof hospitalRatesSchema>): Promise<{ status: "imported" | "skipped"; releaseId: number; groups: number }> {
  const { hospitalKey, file, meta, stats, groups, force } = upload;
  const hospital = hospitalByKey(hospitalKey)!;
  const source = SOURCES.hpt_multicare;

  const existing = await db
    .select({ id: t.sourceReleases.id })
    .from(t.sourceReleases)
    .where(and(eq(t.sourceReleases.sourceKey, source.key), eq(t.sourceReleases.periodLabel, hospitalKey), eq(t.sourceReleases.checksumSha256, file.sha256), ne(t.sourceReleases.status, "failed")));
  if (existing.length && !force) return { status: "skipped", releaseId: existing[0].id, groups: groups.length };

  const releaseId = await db.transaction(async (tx) => {
    if (existing.length) await tx.update(t.sourceReleases).set({ status: "superseded", isCurrent: false }).where(inArray(t.sourceReleases.id, existing.map((e) => e.id)));
    const [release] = await tx
      .insert(t.sourceReleases)
      .values({
        sourceKey: source.key,
        organization: source.organization,
        dataset: `Hospital standard charges (45 CFR 180.50) — ${hospital.name}`,
        periodLabel: hospitalKey,
        fileName: new URL(file.url).pathname.split("/").pop() ?? null,
        downloadUrl: file.url,
        landingPageUrl: MULTICARE_PAGE,
        publicationDate: meta.lastUpdatedOn,
        publicationLabel: `File last updated ${meta.lastUpdatedOn ?? "(not stated)"}; CMS template v${meta.version ?? "?"}`,
        effectiveStart: meta.lastUpdatedOn,
        effectiveEnd: null,
        checksumSha256: file.sha256,
        byteSize: file.bytes,
        recordCount: groups.length,
        status: "processing",
        isCurrent: false,
      })
      .returning({ id: t.sourceReleases.id });
    await insertBatches(
      tx,
      t.hospitalDrugRates,
      groups.map((g) => ({
        hospitalKey,
        hcpcsCode: g.code,
        planType: g.planType,
        setting: g.setting || null,
        billingClass: g.billingClass || null,
        methodology: g.methodology || null,
        drugQuantity: g.drugQuantity == null ? null : String(g.drugQuantity),
        drugUnit: g.drugUnit,
        amounts: g.amounts,
        percentContracts: g.percentContracts,
        algorithmContracts: g.algorithmContracts,
        grossMin: g.grossMin == null ? null : String(g.grossMin),
        grossMax: g.grossMax == null ? null : String(g.grossMax),
        cashMin: g.cashMin == null ? null : String(g.cashMin),
        cashMax: g.cashMax == null ? null : String(g.cashMax),
        sourceReleaseId: release.id,
      })),
      17,
    );
    await tx
      .update(t.sourceReleases)
      .set({ isCurrent: false, status: "superseded" })
      .where(and(eq(t.sourceReleases.sourceKey, source.key), eq(t.sourceReleases.periodLabel, hospitalKey), eq(t.sourceReleases.isCurrent, true), ne(t.sourceReleases.id, release.id)));
    await tx
      .update(t.sourceReleases)
      .set({ isCurrent: true, status: "succeeded", report: { details: { hospitalKey, hospital: hospital.name, ...meta, fileLastModified: file.lastModified, ...stats, groups: groups.length } } })
      .where(eq(t.sourceReleases.id, release.id));
    return release.id;
  });
  return { status: "imported", releaseId, groups: groups.length };
}
