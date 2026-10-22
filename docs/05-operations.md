# Operations runbook

## Environments

| Environment | Database | How data is loaded |
| --- | --- | --- |
| Local development | PGlite in `.data/pglite` (or `DATABASE_URL`) | `npm run ingest -- --source all` |
| Tests | PGlite `memory://` / `.data/e2e-pglite` | Real fixture excerpts via `tests/helpers/fixtures.ts` |
| Vercel production | Neon Postgres (`DATABASE_URL`) | Admin import endpoint or CLI with `DATABASE_URL`; daily cron afterwards |

## Initial load

1. Apply migrations: they run automatically in the Vercel build (`npm run vercel-build`), or locally with `npm run db:migrate`.
2. Import all sources (every CMS quarter from `CODERX_MIN_PERIOD`, default 2021-Q1, that the publisher still posts):
   - CLI (any machine with `DATABASE_URL`): `npm run ingest -- --source all`
   - Or the admin endpoint, one source per request (see README).
3. Check `/sources` (every release, checksum, record count) and `/api/health`.

## Scheduled refresh

`vercel.json` schedules `GET /api/cron/refresh` daily at 10:15 UTC (Vercel Hobby allows one run per day; timing is approximate). The job (`src/ingest/refresh.ts`):

| Source | Imports when |
| --- | --- |
| CMS HCPCS, payment limits, crosswalks | a quarter appears on the CMS page that is not imported, or a quarter’s posting label changed (CMS re-post) |
| FDA NDC directory + excluded | `Last-Modified` is newer than the current snapshot **and** `CODERX_FDA_REFRESH_DAYS` (default 7) have passed — or a new crosswalk was imported the same run |
| FDA Purple Book | a newer monthly file is posted — but FDA blocks Vercel's egress for this file, so the weekly launchd job below does the actual import |
| CMS Medicaid Drug Rebate Program product data | the next quarter's `drugproducts-q{N}-{YYYY}.csv` exists (HEAD probe); the ~330 MB file is streamed and filtered |
| CMS NCCI MUE tables (practitioner, outpatient hospital, DME supplier) | a new quarter's table appears on the CMS MUE page (matched by file name), or a quarter's posting label changed |
| Washington HCA home infusion fee schedule | the manifest pins a newer effective date than the current release. When HCA posts a new schedule, add its URL and effective date to `MANIFEST` in `src/ingest/sources.ts` (no automatic discovery yet) |

Imports run sequentially with a 240-second budget; anything left is deferred to the next run. Derived tables are rebuilt once at the end and the Next.js data cache tag `coderx-data` is revalidated. Each run is logged in `import_runs`.

## Administrator-triggered import

```bash
curl -sS -X POST "https://<domain>/api/admin/import" \
  -H "Authorization: Bearer $CODERX_ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"source":"cms_payment_limits","force":false,"latestOnly":true}'
```

- `source`: `all` or one source key. `latestOnly: false` re-checks every retained quarter. `force: true` re-imports identical files (normally skipped by checksum).
- The endpoint returns 404 when `CODERX_ADMIN_TOKEN` is unset and 401 for a wrong token; it is rate limited to 10 requests/minute per IP.

## Failure handling and rollback

- Every import runs in one database transaction. Any download, integrity (ZIP CRC-32, truncation), parsing, validation, or load error rolls back completely; the previous release stays current.
- The failure is then recorded as a `failed` row in `source_releases` with the error message (visible on `/sources`).
- To roll back a successful but unwanted release, re-import the previous file with `force: true` (it becomes current again) or delete the release’s rows and run `npm run ingest -- --derive-only`.

## Manual review

`data/manual-relationships.json` holds manually reviewed NDC→HCPCS or drug→HCPCS relationships. Each entry requires `kind`, `hcpcsCode`, `ndc11` or `drugSlug`, `evidenceUrl`, `reviewer`, `reviewedAt`, and `notes` (≥ 10 characters); invalid entries are rejected with a warning in the import report. Approved entries appear with the “Manually reviewed” badge. The file ships empty.

## Rate limiting and firewall

`src/proxy.ts` applies per-IP fixed windows per instance (suggest 240/min, search 120/min, other reads 180/min, admin/cron 10/min). For global enforcement add a Vercel Firewall rule, e.g. rate-limit `/api/*` to 300 requests per minute per IP.

## Monitoring

- `/api/health`: database latency, record counts, latest release per source.
- Vercel runtime logs: structured JSON errors (`scope`, `message`) without query text or IP addresses.
- `/sources`: failed releases are listed with their error.

## Secrets

Generate tokens with `openssl rand -base64 48`. Store `DATABASE_URL`, `CODERX_ADMIN_TOKEN`, and `CRON_SECRET` as **sensitive** Vercel environment variables. The Purple Book job reads `CODERX_ADMIN_TOKEN` from `.env.production.local` on the operator's Mac (below). No secret is read by client code; only `NEXT_PUBLIC_SITE_URL` is public.

## Publisher files blocked from cloud egress (Purple Book)

FDA's bot defense blocks the Purple Book CSV for cloud networks: Vercel gets a 404, and GitHub-hosted Actions runners get a 302 to `/apology_objects/abuse-detection-apology.html` for both the downloads page and the file (checked 2026-10-15 from two Azure regions). Ordinary networks are not blocked. The Vercel cron records its failure; the import is done from an operator's Mac by `scripts/refresh-purple-book.ts` (`npm run refresh:purple-book`):

1. Reads FDA's downloads page with the cron's own parser (`parsePurpleBookDownloads` in `src/ingest/discover.ts`) and takes the newest monthly CSV on `www.accessdata.fda.gov`.
2. Skips (exit 0, no upload) when `/api/sources` already lists that period as `succeeded`.
3. Downloads the official file, refusing redirects, HTML responses, and anything over 4 MB (the upload-mode cap), and POSTs it to the admin endpoint's upload mode. Provenance keeps the official URL and the SHA-256 of the uploaded bytes.

### Weekly schedule (launchd)

```bash
scripts/purple-book-launchd.sh install     # writes ~/Library/LaunchAgents/com.coderx.purple-book-refresh.plist and loads it
scripts/purple-book-launchd.sh status      # launchd state and the last log lines
scripts/purple-book-launchd.sh run         # run now, exactly as launchd does (add --dry-run or --force)
scripts/purple-book-launchd.sh uninstall
```

- Runs Mondays at 09:00 local time; if the Mac is asleep then, launchd runs it at the next wake (a week missed while the Mac is off is caught the next Monday). FDA posts the monthly file on no fixed day, and runs after the import are no-ops.
- Targets `CODERX_BASE_URL` as set at install time (default `https://coderxnsl.vercel.app`) and waits up to 10 minutes for the network after wake.
- Reads `CODERX_ADMIN_TOKEN` at run time from `.env.production.local` in the checkout; the token is never copied into the plist or written to the log. Rotate it there and in Vercel together.
- Runs the code checked out in that folder, so keep a branch with `scripts/refresh-purple-book.ts` checked out there (main once merged) and `npm ci` done. Node comes from `CODERX_NODE` at install time (default `/usr/local/bin/node`).
- Log: `~/Library/Logs/coderx-purple-book-refresh.log`. A failed run (FDA block page, layout change, rejected upload, missing token) exits 1 and posts a macOS notification.

### Manual upload

`CODERX_ADMIN_TOKEN=… npm run refresh:purple-book -- --base-url https://coderxnsl.vercel.app` from any machine FDA does not block, or the same request by hand:

```bash
U=https://www.accessdata.fda.gov/drugsatfda_docs/PurpleBook/2026/purplebook-search-September-data-download.csv
curl -sSo pb.csv "$U"
curl -sS -X POST "https://<domain>/api/admin/import?source=fda_purple_book&period=2026-09&url=$U" \
  -H "Authorization: Bearer $CODERX_ADMIN_TOKEN" -H "Content-Type: text/csv" --data-binary @pb.csv
```

Upload mode accepts only known source keys, an official URL from that source's publisher (`www.cms.gov` / `www.accessdata.fda.gov` for federal sources, `www.hca.wa.gov` for the Washington HCA fee schedule), and files up to 4 MB. For example:

```bash
U=https://www.hca.wa.gov/assets/billers-and-providers/home-infusion-parenteral-nutrition-20260701.xlsx
curl -sS -X POST "https://<domain>/api/admin/import?source=wa_hca_home_infusion&period=2026-07-01&url=$U" \
  -H "Authorization: Bearer $CODERX_ADMIN_TOKEN" --data-binary @home-infusion-parenteral-nutrition-20260701.xlsx
```
