/**
 * Washington coverage refresh, run on the operator's Mac (Cambia's formulary files are about 400 MB
 * and a refresh needs about 2 GB of memory, too much for a Vercel function).
 *
 *   npm run refresh:wa-coverage -- [--base-url https://<domain>] [--skip-refresh] [--only apple_health,exchange,nadac] [--force] [--dry-run]
 *
 * 1. Runs the checker's refresh in wa-coverage-check/ (`npm run refresh`), which downloads the Apple Health
 *    PDL, the exchange insurers' files, and NADAC and checks each one (see wa-coverage-check/src/refresh.ts).
 *    --skip-refresh uploads what is already in wa-coverage-check/cache/.
 * 2. Builds one upload per dataset, checks it against the server's own schema, and POSTs it gzip-compressed
 *    to /api/admin/wa-coverage with CODERX_ADMIN_TOKEN (from the environment or .env.production.local).
 *    The site skips data it already has (same SHA-256) unless --force.
 *
 * Exit 0 when every upload was imported or skipped, 1 otherwise.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { gzipSync } from "node:zlib";
import { USER_AGENT } from "@/ingest/fetch";
import { WA_INSURER_KEYS, waUploadSchema, type WaUpload } from "@/ingest/wa-formularies";

/** Vercel refuses request bodies over 4.5 MB; the gzip-compressed uploads are well under this. */
const UPLOAD_MAX_BYTES = 4_000_000;
const CHECKER = join(process.cwd(), "wa-coverage-check");
const CACHE = join(CHECKER, "cache");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(name);
const log = (m: string) => console.log(`wa-coverage: ${m}`);
const read = <T>(name: string): T => JSON.parse(readFileSync(join(CACHE, name), "utf8")) as T;

interface SourceInfo {
  url: string;
  fetchedAt: string;
  asOf: string;
}
type Manifest = Record<string, SourceInfo>;

/** "Effective November 14, 2026 - November 20, 2026" -> ["2026-11-14", "2026-11-20"] */
export function effectiveDates(asOf: string): [string, string | null] {
  const dates = [...asOf.matchAll(/([A-Z][a-z]+ \d{1,2}, \d{4})/g)].map((m) => new Date(`${m[1]} 00:00:00 UTC`).toISOString().slice(0, 10));
  if (!dates.length) throw new Error(`No effective date in the Apple Health PDL's label: "${asOf}"`);
  return [dates[0], dates[1] ?? null];
}

/** The first HTTP date in "…last modified Thu, 12 Nov 2026 17:50:21 GMT / …", or null. */
const firstHttpDate = (asOf: string) => /[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT/.exec(asOf)?.[0] ?? null;

function adminToken(): string {
  if (process.env.CODERX_ADMIN_TOKEN) return process.env.CODERX_ADMIN_TOKEN;
  const file = ".env.production.local";
  const token = existsSync(file) ? parseEnv(readFileSync(file, "utf8")).CODERX_ADMIN_TOKEN : undefined;
  if (!token) throw new Error("Set CODERX_ADMIN_TOKEN or add it to .env.production.local.");
  return token;
}

/** The SHA-256 and size of the data itself, so the same data uploaded twice is skipped. */
function fingerprint(data: unknown): { sha256: string; bytes: number } {
  const json = JSON.stringify(data);
  return { sha256: createHash("sha256").update(json).digest("hex"), bytes: Buffer.byteLength(json) };
}

function buildUploads(only: Set<string> | null, force: boolean): { name: string; body: WaUpload }[] {
  const manifest = read<Manifest>("manifest.json");
  const uploads: { name: string; body: WaUpload }[] = [];

  if (!only || only.has("apple_health")) {
    const info = manifest.appleHealth;
    const pdl = read<Record<string, Omit<Extract<WaUpload, { kind: "apple_health" }>["rows"][number], "ndc11">>>("apple-health.json");
    const rows = Object.entries(pdl).map(([ndc11, r]) => ({ ndc11, ...r }));
    const [effectiveStart, effectiveEnd] = effectiveDates(info.asOf);
    uploads.push({ name: "Apple Health PDL", body: { kind: "apple_health", url: info.url, effectiveStart, effectiveEnd, asOf: info.asOf, lastModified: null, force, ...fingerprint({ asOf: info.asOf, rows }), rows } });
  }

  if (!only || only.has("exchange")) {
    for (const key of WA_INSURER_KEYS) {
      const info = manifest[key];
      if (!info) throw new Error(`The checker's cache has no ${key} source; run without --skip-refresh.`);
      const index = read<{ plans: Record<string, { name: string; costs: Record<string, string> }>; drugs: Record<string, { planId: string; tier: string; pa: boolean; st: boolean; ql: boolean }[]> }>(`${key}.json`);
      const plans = Object.entries(index.plans).map(([planId, p]) => ({ planId, name: p.name, costs: p.costs }));
      // Cambia's two files repeat many listings word for word; exact repeats change no answer, so they are dropped.
      const drugs = Object.entries(index.drugs).map(([rxcui, listings]) => ({ rxcui, listings: [...new Map(listings.map((l) => [JSON.stringify([l.planId, l.tier, l.pa, l.st, l.ql]), { planId: l.planId, tier: l.tier, pa: l.pa, st: l.st, ql: l.ql }])).values()] }));
      const planYear = Number(/plan year (\d{4})/.exec(info.asOf)?.[1]);
      if (!planYear) throw new Error(`No plan year in the ${key} label: "${info.asOf}"`);
      uploads.push({ name: `Exchange (${key})`, body: { kind: "exchange", insurerKey: key, url: info.url, planYear, asOf: info.asOf, lastModified: firstHttpDate(info.asOf), force, ...fingerprint({ asOf: info.asOf, plans, drugs }), plans, drugs } });
    }
  }

  if (!only || only.has("nadac")) {
    const info = manifest.nadac;
    const index = read<Record<string, { description: string; perUnit: number; unit: string; effectiveDate: string; classification: string }>>("nadac.json");
    const rows = Object.entries(index).map(([ndc11, n]) => ({ ndc11, ...n }));
    const weekOf = /week of (\d{4}-\d{2}-\d{2})/.exec(info.asOf)?.[1];
    if (!weekOf) throw new Error(`No week in the NADAC label: "${info.asOf}"`);
    uploads.push({ name: "NADAC", body: { kind: "nadac", url: info.url, weekOf, asOf: info.asOf, lastModified: null, force, ...fingerprint({ asOf: info.asOf, rows }), rows } });
  }
  return uploads;
}

async function main() {
  const base = (arg("--base-url") ?? "https://coderxnsl.vercel.app").replace(/\/$/, "");
  const only = arg("--only") ? new Set(arg("--only")!.split(",")) : null;
  const dryRun = has("--dry-run");

  if (!has("--skip-refresh")) {
    if (!existsSync(join(CHECKER, "node_modules"))) {
      log("installing the checker's dependencies (npm ci)");
      if (spawnSync("npm", ["ci"], { cwd: CHECKER, stdio: "inherit" }).status !== 0) throw new Error("npm ci failed in wa-coverage-check/.");
    }
    log("running the checker's refresh (several minutes; about 2 GB of memory)");
    const env = { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS ?? "--max-old-space-size=4096" };
    if (spawnSync("npm", ["run", "refresh"], { cwd: CHECKER, stdio: "inherit", env }).status !== 0) throw new Error("The checker's refresh failed; nothing was uploaded.");
  }

  const uploads = buildUploads(only, has("--force"));
  const token = dryRun ? "" : adminToken();
  let failed = 0;
  for (const { name, body } of uploads) {
    // The server checks the same schema; checking here first gives a clear local error.
    const parsed = waUploadSchema.safeParse(body);
    if (!parsed.success) {
      log(`${name}: does not match the upload schema: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
      failed++;
      continue;
    }
    const gz = gzipSync(JSON.stringify(body));
    log(`${name}: ${body.bytes.toLocaleString()} bytes of data, ${gz.byteLength.toLocaleString()} gzip-compressed (${body.asOf})`);
    if (gz.byteLength > UPLOAD_MAX_BYTES) {
      log(`${name}: too large to upload (${gz.byteLength} > ${UPLOAD_MAX_BYTES} bytes)`);
      failed++;
      continue;
    }
    if (dryRun) continue;
    const res = await fetch(`${base}/api/admin/wa-coverage`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Content-Encoding": "gzip", "User-Agent": USER_AGENT },
      body: gz,
    });
    const text = await res.text();
    if (!res.ok) {
      log(`${name}: HTTP ${res.status} ${text.slice(0, 500)}`);
      failed++;
      continue;
    }
    const result = (JSON.parse(text) as { data: { status: string; releaseId: number; records: number } }).data;
    log(`${name}: ${result.status} (release ${result.releaseId}, ${result.records.toLocaleString()} records)`);
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1]?.endsWith("refresh-wa-coverage.ts")) {
  main().catch((error) => {
    console.error(`wa-coverage: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
