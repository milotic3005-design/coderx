# Operations runbook

## Environments

| Environment | Database | How data is loaded |
| --- | --- | --- |
| Local development | PGlite in `.data/pglite` (or `DATABASE_URL`) | `npm run ingest -- --source all` |
| Tests | PGlite `memory://` / `.data/e2e-pglite` | Real fixture excerpts via `tests/helpers/fixtures.ts` |
| Vercel production | Neon Postgres (`DATABASE_URL`) | Admin import endpoint or CLI with `DATABASE_URL`; daily cron afterwards |

## Initial load

1. Apply migrations: they run automatically in the Vercel build (`npm run vercel-build`), or locally with `npm run db:migrate`.
2. Import all sources (8 quarters of CMS history):
   - CLI (any machine with `DATABASE_URL`): `npm run ingest -- --source all`
   - Or the admin endpoint, one source per request (see README).
3. Check `/sources` (every release, checksum, record count) and `/api/health`.

## Scheduled refresh

`vercel.json` schedules `GET /api/cron/refresh` daily at 10:15 UTC (Vercel Hobby allows one run per day; timing is approximate). The job (`src/ingest/refresh.ts`):

| Source | Imports when |
| --- | --- |
| CMS HCPCS, payment limits, crosswalks | a quarter appears on the CMS page that is not imported, or a quarter’s posting label changed (CMS re-post) |
| FDA NDC directory + excluded | `Last-Modified` is newer than the current snapshot **and** `CODERX_FDA_REFRESH_DAYS` (default 7) have passed — or a new crosswalk was imported the same run |
| FDA Purple Book | a newer monthly file is posted |

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

Generate tokens with `openssl rand -base64 48`. Store `DATABASE_URL`, `CODERX_ADMIN_TOKEN`, and `CRON_SECRET` as **sensitive** Vercel environment variables. No secret is read by client code; only `NEXT_PUBLIC_SITE_URL` is public.

## Publisher files blocked from cloud egress (Purple Book)

FDA's accessdata server answers 404 to requests from Vercel's network for the Purple Book CSV (it works from ordinary networks). The cron records the failure; refresh it monthly by uploading the official file — provenance keeps the official URL and the SHA-256 of the uploaded bytes:

```bash
U=https://www.accessdata.fda.gov/drugsatfda_docs/PurpleBook/2026/purplebook-search-September-data-download.csv
curl -sSo pb.csv "$U"
curl -sS -X POST "https://<domain>/api/admin/import?source=fda_purple_book&period=2026-09&url=$U" \
  -H "Authorization: Bearer $CODERX_ADMIN_TOKEN" -H "Content-Type: text/csv" --data-binary @pb.csv
```

Upload mode accepts only known source keys, official `www.cms.gov` / `www.accessdata.fda.gov` URLs, and files up to 4 MB.
