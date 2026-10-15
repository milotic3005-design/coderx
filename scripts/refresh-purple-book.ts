/**
 * Purple Book refresh from outside Vercel (FDA answers 404 to Vercel's egress for the CSV).
 * Run weekly on an operator's Mac by scripts/purple-book-launchd.sh; see docs/05-operations.md.
 *
 *   CODERX_ADMIN_TOKEN=… npm run refresh:purple-book -- --base-url https://<domain> [--dry-run] [--force]
 *
 * 1. Discover the newest monthly CSV on FDA's downloads page (the cron's parser, official host only).
 * 2. Skip when <base-url>/api/sources already lists that period as succeeded (unless --force).
 * 3. Download the official file (no redirects, not HTML, same 4 MB cap as upload mode) and POST it to the
 *    admin import endpoint; provenance keeps the official URL and the SHA-256 of the uploaded bytes.
 *
 * Exit 0 on imported / skipped, 1 on any failure.
 */
import { parsePurpleBookDownloads } from "@/ingest/discover";
import { download, fetchPage, USER_AGENT } from "@/ingest/fetch";
import { SOURCES } from "@/ingest/sources";

const UPLOAD_MAX_BYTES = 4_000_000;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(name);

function report(message: string) {
  console.log(`purple-book: ${message}`);
}

interface SourcesResponse {
  data: { releases: { sourceKey: string; period: string | null; releaseStatus: string; checksum: string | null }[] } | null;
}

async function main() {
  const base = (arg("--base-url") ?? process.env.CODERX_BASE_URL ?? "").replace(/\/+$/, "");
  if (!/^https?:\/\//.test(base)) throw new Error("Set --base-url or CODERX_BASE_URL to the deployment origin.");
  const dryRun = has("--dry-run") || process.env.CODERX_DRY_RUN === "true";
  const force = has("--force") || process.env.CODERX_FORCE === "true";

  const newest = parsePurpleBookDownloads(await fetchPage(SOURCES.fda_purple_book.landingPageUrl)).at(-1);
  if (!newest?.period) {
    throw new Error(`No monthly CSV link found on ${SOURCES.fda_purple_book.landingPageUrl}; FDA served a block page or the page layout changed.`);
  }
  report(`Newest file on FDA's downloads page: ${newest.period} — ${newest.url}`);

  const res = await fetch(`${base}/api/sources`, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${base}/api/sources: HTTP ${res.status}`);
  const { data } = (await res.json()) as SourcesResponse;
  const current = data?.releases.find((r) => r.sourceKey === "fda_purple_book" && r.period === newest.period && r.releaseStatus === "succeeded");
  if (current && !force) {
    report(`Skipped: ${newest.period} is already imported (SHA-256 ${current.checksum}).`);
    return;
  }
  if (dryRun) {
    report(`Dry run: would download and upload ${newest.period}.`);
    return;
  }

  const token = process.env.CODERX_ADMIN_TOKEN;
  if (!token) throw new Error("CODERX_ADMIN_TOKEN is not set.");
  // FDA's bot defense answers with a 302 to an HTML "apology" page; never upload that as the CSV.
  const file = await download(newest.url, { maxBytes: UPLOAD_MAX_BYTES, redirects: "refuse" });
  if (/^\s*<(!doctype|html|head|body)\b/i.test(new TextDecoder().decode(file.bytes.subarray(0, 512)))) {
    throw new Error(`Refusing ${newest.url}: the response is an HTML page, not the CSV.`);
  }
  report(`Downloaded ${file.byteSize} bytes, SHA-256 ${file.sha256}.`);

  const qs = new URLSearchParams({ source: "fda_purple_book", period: newest.period, url: newest.url });
  const upload = await fetch(`${base}/api/admin/import?${qs}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/csv", "User-Agent": USER_AGENT },
    body: Buffer.from(file.bytes),
  });
  const body = (await upload.json().catch(() => null)) as {
    data: { outcome: { status: string; releaseId?: number; reason?: string } } | null;
    error: { code: string; message: string } | null;
  } | null;
  if (!upload.ok || !body?.data) throw new Error(`Upload rejected: HTTP ${upload.status} ${body?.error ? `${body.error.code} — ${body.error.message}` : ""}`.trim());
  const { outcome } = body.data;
  if (outcome.status === "failed") throw new Error(`Import failed: ${outcome.reason ?? "no reason given"}`);
  report(`Import ${outcome.status}${outcome.releaseId ? ` as release ${outcome.releaseId}` : ""}${outcome.reason ? ` (${outcome.reason})` : ""}.`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("purple-book: failed —", message);
  process.exit(1);
});
