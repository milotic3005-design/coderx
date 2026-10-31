/**
 * MultiCare price benchmark refresh, run on the operator's Mac (the files are 1–1.4 GB each).
 * Monthly via scripts/price-benchmark-launchd.sh; see docs/05-operations.md.
 *
 *   CODERX_ADMIN_TOKEN=… npm run refresh:price-benchmark -- --base-url https://<domain> [--dry-run] [--force] [--only yakima-memorial,valley] [--out <dir>]
 *
 * For each MultiCare hospital file (src/ingest/hospitals.ts):
 * 1. HEAD the file; when its Last-Modified matches the local cache (and not --force), reuse the cache.
 * 2. Otherwise stream it, keeping only HCPCS drug rows (src/ingest/parsers/hospital-mrf.ts), and cache
 *    the contracts (payer and plan names included) under <out>/cache/.
 * 3. Upload the anonymized groups (no payer or plan names) to POST /api/admin/hospital-rates, unless the
 *    site already has that file's SHA-256.
 * Then write the private report to <out>: multicare-drug-rates.csv (every contract) and index.html
 * (search a code; rates by payer and plan per CMS billing unit). Nothing in <out> is uploaded.
 *
 * Exit 0 when every hospital was imported or skipped, 1 otherwise.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseAspLandingPage } from "@/ingest/discover";
import { download, fetchPage, headInfo, streamDownload, USER_AGENT } from "@/ingest/fetch";
import { MULTICARE_HOSPITALS, type HospitalFile } from "@/ingest/hospitals";
import { parsePaymentLimitCsv } from "@/ingest/parsers/cms-payment";
import { anonymize, parseHospitalMrfStream, planTypeOf, type HospitalDrugContract, type HospitalMeta } from "@/ingest/parsers/hospital-mrf";
import { manifestFor, SOURCES } from "@/ingest/sources";
import { decodeText } from "@/ingest/text-decode";
import { baseName, unzipVerified } from "@/ingest/zip";
import { parseCmsDosage } from "@/lib/billing";
import { median, PER_UNIT_METHODOLOGIES, PLAN_TYPE_LABELS, toBillingUnitFactor } from "@/lib/hospital-rates";

const UPLOAD_MAX_BYTES = 4_000_000;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(name);
const log = (m: string) => console.log(`price-benchmark: ${m}`);

interface Cached {
  hospital: HospitalFile;
  lastModified: string | null;
  sha256: string;
  bytes: number;
  meta: HospitalMeta;
  stats: { rowsRead: number; drugRows: number; contracts: number };
  contracts: HospitalDrugContract[];
}

interface SourcesResponse {
  data: { releases: { sourceKey: string; period: string | null; releaseStatus: string; checksum: string | null; isCurrent?: boolean }[] } | null;
}

/** CMS payment limit and billing unit per code, from the newest Part B payment limit file. */
async function cmsLimits(): Promise<{ period: string; byCode: Map<string, { limit: number | null; dosage: string | null }> }> {
  let candidate = manifestFor("cms_payment_limits").at(-1)!;
  try {
    // The ASP page also lists the NDC–HCPCS crosswalks; keep payment limit files only.
    const found = parseAspLandingPage(await fetchPage(SOURCES.cms_payment_limits.landingPageUrl))
      .filter((c) => c.sourceKey === "cms_payment_limits")
      .sort((a, b) => (a.period ?? "").localeCompare(b.period ?? ""))
      .at(-1);
    if (found) candidate = found;
  } catch {
    // CMS page unreachable: the pinned manifest file is used.
  }
  const file = await download(candidate.url);
  const entry = unzipVerified(file.bytes, (n) => n.toLowerCase().endsWith(".csv")).find((e) => /(payment limit file|asp pricing file)/i.test(baseName(e.name)) && !/not payable/i.test(e.name));
  if (!entry) throw new Error(`No payment limit CSV in ${candidate.url}`);
  const rows = parsePaymentLimitCsv(decodeText(entry.data).text).rows;
  return { period: candidate.period ?? "", byCode: new Map(rows.map((r) => [r.hcpcsCode, { limit: r.paymentLimit == null ? null : Number(r.paymentLimit), dosage: r.dosageDescriptor }])) };
}

async function loadHospital(h: HospitalFile, cacheDir: string, force: boolean): Promise<Cached> {
  const cachePath = join(cacheDir, `${h.key}.json`);
  const head = await headInfo(h.url);
  if (!force && existsSync(cachePath)) {
    const cached = JSON.parse(readFileSync(cachePath, "utf8")) as Cached;
    if (cached.lastModified && cached.lastModified === head.lastModified && cached.hospital.url === h.url) {
      log(`${h.key}: unchanged since ${cached.lastModified} (cached)`);
      return cached;
    }
  }
  log(`${h.key}: downloading ${(head.contentLength ?? 0) / 1048576 > 0 ? `${Math.round((head.contentLength ?? 0) / 1048576)} MB` : ""} ${h.url}`);
  const started = Date.now();
  const src = await streamDownload(h.url, { maxBytes: 4 * 1024 ** 3, timeoutMs: 3_600_000 });
  const parsed = await parseHospitalMrfStream(src.chunks);
  const { sha256, byteSize } = src.result();
  const cached: Cached = {
    hospital: h,
    lastModified: src.lastModified,
    sha256,
    bytes: byteSize,
    meta: parsed.meta,
    stats: { rowsRead: parsed.rowsRead, drugRows: parsed.drugRows, contracts: parsed.contracts.length },
    contracts: parsed.contracts,
  };
  writeFileSync(cachePath, JSON.stringify(cached));
  log(`${h.key}: ${parsed.rowsRead.toLocaleString()} rows, ${parsed.drugRows.toLocaleString()} drug rows, ${parsed.contracts.length.toLocaleString()} contracts in ${Math.round((Date.now() - started) / 1000)} s (SHA-256 ${sha256.slice(0, 12)}…)`);
  return cached;
}

async function upload(base: string, token: string, c: Cached, force: boolean) {
  const groups = anonymize(c.contracts);
  const body = JSON.stringify({ hospitalKey: c.hospital.key, file: { url: c.hospital.url, sha256: c.sha256, bytes: c.bytes, lastModified: c.lastModified }, meta: c.meta, stats: c.stats, groups, force });
  if (body.length > UPLOAD_MAX_BYTES) throw new Error(`${c.hospital.key}: upload is ${body.length} bytes, over the ${UPLOAD_MAX_BYTES}-byte limit.`);
  const res = await fetch(`${base}/api/admin/hospital-rates`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": USER_AGENT }, body });
  const json = (await res.json().catch(() => null)) as { data: { status: string; releaseId?: number } | null; error: { code: string; message: string; details?: unknown } | null } | null;
  if (!res.ok || !json?.data) throw new Error(`${c.hospital.key}: upload rejected: HTTP ${res.status} ${json?.error ? `${json.error.code} — ${json.error.message} ${JSON.stringify(json.error.details ?? "")}` : ""}`.trim());
  log(`${c.hospital.key}: ${json.data.status}${json.data.releaseId ? ` (release #${json.data.releaseId})` : ""}, ${groups.length} anonymized groups`);
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

function writeReport(out: string, hospitals: Cached[], cms: Awaited<ReturnType<typeof cmsLimits>>) {
  const header = ["hospital", "hcpcs_code", "payer", "plan", "plan_type", "setting", "billing_class", "methodology", "negotiated_dollar", "negotiated_percentage", "negotiated_algorithm", "drug_quantity", "drug_unit", "per_cms_billing_unit", "cms_billing_unit", "cms_payment_limit", "pct_of_cms_limit", "gross_min", "gross_max", "cash_min", "cash_max", "ndcs", "chargemaster_descriptions", "file_last_updated"];
  const lines = [header.join(",")];
  // code → payer|plan → per-unit amounts and hospitals (outpatient facility, per-unit methodologies).
  const byCode = new Map<string, Map<string, { payer: string; plan: string; planType: string; perUnit: number[]; hospitals: Set<string> }>>();
  for (const h of hospitals) {
    for (const c of h.contracts) {
      const cmsRow = cms.byCode.get(c.code);
      const factor = toBillingUnitFactor(c.drugQuantity, c.drugUnit, parseCmsDosage(cmsRow?.dosage ?? null));
      const perUnit = c.dollar != null && factor != null ? Math.round(c.dollar * factor * 100) / 100 : null;
      const pct = perUnit != null && cmsRow?.limit ? Math.round((perUnit / cmsRow.limit) * 100) : null;
      const planType = PLAN_TYPE_LABELS[planTypeOf(c.payer, c.plan)];
      lines.push([h.hospital.name, c.code, c.payer, c.plan, planType, c.setting, c.billingClass, c.methodology, c.dollar, c.percentage, c.algorithm, c.drugQuantity, c.drugUnit, perUnit, cmsRow?.dosage, cmsRow?.limit, pct, c.grossMin, c.grossMax, c.cashMin, c.cashMax, c.ndcs.join(" "), c.descriptions.join(" | "), h.meta.lastUpdatedOn].map(csvCell).join(","));
      if (perUnit == null || c.setting !== "outpatient" || c.billingClass !== "facility" || !PER_UNIT_METHODOLOGIES.includes(c.methodology)) continue;
      const payers = byCode.get(c.code) ?? new Map();
      byCode.set(c.code, payers);
      const k = `${c.payer}|${c.plan}`;
      const e = payers.get(k) ?? { payer: c.payer, plan: c.plan, planType, perUnit: [], hospitals: new Set<string>() };
      e.perUnit.push(perUnit);
      e.hospitals.add(h.hospital.name);
      payers.set(k, e);
    }
  }
  writeFileSync(join(out, "multicare-drug-rates.csv"), lines.join("\n"));

  const data: Record<string, { limit: number | null; unit: string | null; rows: [string, string, string, number, number, number, number, number | null][] }> = {};
  for (const [code, payers] of byCode) {
    const cmsRow = cms.byCode.get(code);
    data[code] = {
      limit: cmsRow?.limit ?? null,
      unit: cmsRow?.dosage ?? null,
      rows: [...payers.values()]
        .map((p) => {
          const s = p.perUnit.sort((a, b) => a - b);
          const med = Math.round(median(s)! * 100) / 100;
          return [p.payer, p.plan, p.planType, p.hospitals.size, s[0], med, s.at(-1)!, cmsRow?.limit ? Math.round((med / cmsRow.limit) * 100) : null] as [string, string, string, number, number, number, number, number | null];
        })
        .sort((a, b) => b[5] - a[5]),
    };
  }
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MultiCare drug rates (private)</title>
<style>body{font:15px/1.45 system-ui,sans-serif;margin:24px;color:#1b1b1b;background:#fff}h1{font-size:22px;margin:0 0 4px}p{color:#555;margin:4px 0 16px}input{font:inherit;padding:8px 10px;width:12rem;text-transform:uppercase}table{border-collapse:collapse;margin-top:16px;width:100%}th,td{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left;font-variant-numeric:tabular-nums}th{background:#f4f4f4;font-size:13px}td.n{text-align:right}</style></head><body>
<h1>MultiCare negotiated drug rates — private report</h1>
<p>Built ${esc(new Date().toISOString().slice(0, 10))} from ${hospitals.length} hospital files (${esc(hospitals.map((h) => `${h.hospital.name}: ${h.meta.lastUpdatedOn ?? "?"}`).join("; "))}). Outpatient facility contracts priced by fee schedule or percent of billed charges, per CMS billing unit; CMS payment limits from ${esc(cms.period)}. Contains payer names: keep this file private. Full detail: multicare-drug-rates.csv.</p>
<label>HCPCS code <input id="q" placeholder="J9312" autofocus></label><div id="out"></div>
<script>const D=${JSON.stringify(data).replace(/</g, "\\u003c")};const e=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[c]);const money=n=>n==null?"—":"$"+n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
function show(){const c=document.getElementById("q").value.trim().toUpperCase();const d=D[c];const o=document.getElementById("out");if(!d){o.innerHTML=c?"<p>No outpatient per-unit contracts for "+c.replace(/[^A-Z0-9]/g,"")+".</p>":"";return}
o.innerHTML="<p>"+e(c)+": CMS billing unit "+e(d.unit||"—")+", payment limit "+money(d.limit)+"</p><table><tr><th>Payer</th><th>Plan</th><th>Plan type</th><th>Hospitals</th><th>Min</th><th>Median</th><th>Max</th><th>Median % of CMS limit</th></tr>"+d.rows.map(r=>"<tr><td>"+e(r[0])+"</td><td>"+e(r[1])+"</td><td>"+e(r[2])+"</td><td class=n>"+r[3]+"</td><td class=n>"+money(r[4])+"</td><td class=n>"+money(r[5])+"</td><td class=n>"+money(r[6])+"</td><td class=n>"+(r[7]==null?"—":r[7]+"%")+"</td></tr>").join("")+"</table>"}
document.getElementById("q").addEventListener("input",show);</script></body></html>`;
  writeFileSync(join(out, "index.html"), html);
  log(`report: ${join(out, "index.html")} and multicare-drug-rates.csv (${(lines.length - 1).toLocaleString()} contracts)`);
}

async function main() {
  const base = (arg("--base-url") ?? process.env.CODERX_BASE_URL ?? "").replace(/\/+$/, "");
  if (!/^https?:\/\//.test(base)) throw new Error("Set --base-url or CODERX_BASE_URL to the deployment origin.");
  const dryRun = has("--dry-run");
  const force = has("--force");
  const only = arg("--only")?.split(",").map((s) => s.trim());
  const out = arg("--out") ?? join(homedir(), "Documents", "CodeRx Price Benchmark");
  const cacheDir = join(out, "cache");
  mkdirSync(cacheDir, { recursive: true });
  const token = process.env.CODERX_ADMIN_TOKEN;
  if (!dryRun && !token) throw new Error("CODERX_ADMIN_TOKEN is not set.");

  const res = await fetch(`${base}/api/sources`, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${base}/api/sources: HTTP ${res.status}`);
  const { data } = (await res.json()) as SourcesResponse;
  const onSite = new Map((data?.releases ?? []).filter((r) => r.sourceKey === "hpt_multicare" && r.releaseStatus === "succeeded").map((r) => [`${r.period}|${r.checksum}`, r]));

  const cms = await cmsLimits();
  log(`CMS payment limits ${cms.period}: ${cms.byCode.size} codes`);
  const done: Cached[] = [];
  let failures = 0;
  for (const h of MULTICARE_HOSPITALS.filter((x) => !only || only.includes(x.key))) {
    try {
      const c = await loadHospital(h, cacheDir, force);
      done.push(c);
      if (onSite.has(`${h.key}|${c.sha256}`) && !force) log(`${h.key}: already on the site (SHA-256 ${c.sha256.slice(0, 12)}…)`);
      else if (dryRun) log(`${h.key}: dry run — would upload ${anonymize(c.contracts).length} anonymized groups`);
      else await upload(base, token!, c, force);
    } catch (error) {
      failures++;
      log(`${h.key}: FAILED — ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  // The report covers every hospital in the cache, including ones not refreshed this run.
  const all = MULTICARE_HOSPITALS.map((h) => done.find((d) => d.hospital.key === h.key) ?? (existsSync(join(cacheDir, `${h.key}.json`)) ? (JSON.parse(readFileSync(join(cacheDir, `${h.key}.json`), "utf8")) as Cached) : null)).filter((c): c is Cached => !!c);
  if (all.length) writeReport(out, all, cms);
  if (failures) process.exit(1);
}

main().catch((error) => {
  log(`failed — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
