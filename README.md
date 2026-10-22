# CodeRx

**Drug coding and reimbursement intelligence, simplified.**

CodeRx lets pharmacists, infusion centers, coders, billers, revenue-cycle, and prior-authorization teams search a **brand or generic drug name, HCPCS code (J, Q, C, A, P, S, NOC), NDC in any common format, or manufacturer** and see the coding, package, billing-unit, and Medicare Part B reimbursement data that public CMS and FDA files support — with the source file, publication date, effective period, and import date on every section.

> This application provides informational coding and reimbursement reference data. It does not constitute legal, clinical, coding, or billing advice. Codes, payment amounts, payer rules, and coverage policies can change. Verify all information with current CMS publications, the applicable payer, and your organization’s compliance policies before submitting a claim.

## What it does

- **Universal search** with debounced, keyboard-accessible type-ahead grouped into Drugs, HCPCS codes, NDC packages, and Manufacturers; exact-code and NDC matching (4-4-2, 5-3-2, 5-4-1, 5-4-2, 10/11 digits, claim-style `N4…`), prefix, ingredient, manufacturer, abbreviation expansion (IVIG, MTX…), and typo tolerance — every hit explains why it matched.
- **Home infusion per diem S-codes** on every drug page (S9325–S9563: antibiotic by dosing interval, chemotherapy, immune globulin, anti-TNF, TPN, pain, and more), matched from the FDA pharmacologic class and route and labeled derived — CMS publishes no drug-to-per-diem crosswalk. The Reimbursement section shows each S-code’s CMS coverage code and pricing indicator, confirms against the payment limit file that CMS sets no national per diem rate, and explains Medicare’s home infusion therapy services codes (G0068–G0070, G0088–G0090).
- **Drug, HCPCS, NDC, and manufacturer pages** with overview, coding, NDC packages and billable units, Medicare payment limits (every quarter since 2021-Q1, with CMS revisions), biosimilar ↔ reference relationships, code history, data sources, and limitations.
- **Billing-unit calculator** that shows its formula: rounding, vial utilization, leftover quantity, and units attributable to discarded drug from single-dose containers — plus a **CMS MUE check** (max units per day by setting), **claim lines** (HCPCS units, JW/JZ, and the `N4` NDC segment with unit qualifier and quantity), a **vial optimizer** (least-waste vial mix and whole-vial dose-rounding options within a threshold you set), and a **printable worksheet** with no patient fields.
- **Tools for directors** (`/tools`): a **chargemaster & formulary audit** (terminated codes, NDCs missing from the CMS crosswalk, mismatched code–NDC pairs, FDA listing problems, payment limits, MUEs; CSV export), a **margin analyzer** (your acquisition cost vs. the Part B payment net of sequestration — costs never leave the browser), a **biosimilar comparator**, and **what changed this quarter** (payment-limit movers, new/terminated drug codes, crosswalk changes, a personal watchlist).
- **More tools**: a **vial barcode scanner** (phone camera, photo, or USB scanner → GS1 DataMatrix → NDC, code, billable units, container type, Medicaid unit, lot, expiry), a **biosimilar switch simulator**, a **chair capacity planner**, and an **RSS feed** of quarterly changes (filterable to your watchlist codes).
- **Coverage & policy links** on every code and drug page to the CMS Medicare Coverage Database, SAD exclusion lists, MAC directory, and JW/JZ guidance (linked, not copied — see the licensing note below).
- **Fast navigation**: a **command palette** (Ctrl+K / ⌘K) to jump to any drug, code, NDC, or tool; an **at-a-glance strip** on code, drug, and NDC pages (billing unit, payment limit, MUE, coinsurance, NDC count) with a **sticky bar** that keeps the key numbers in view while scrolling; and a calculator result summary that stays pinned (bottom bar on phones).
- **Provenance by design**: badges for Official CMS, Official FDA, Derived calculation, Manually reviewed, Historical, and Verification needed; “No authoritative public data was located for this field.” wherever data is missing.
- **JSON API** with a consistent envelope (`data`, `meta.pagination`, `meta.match`, `meta.provenance`, `error`).

## Data sources (all public U.S. Government data)

| Source | Publisher | Cadence | In CodeRx |
| --- | --- | --- | --- |
| HCPCS Level II quarterly file + NOC code list | CMS | Quarterly | 2023-Q1 → 2026-Q4 in production (all quarterly files CMS still posts) |
| Medicare Part B drug payment limit (ASP) files + “Not payable” list | CMS | Quarterly + revisions | 2021-Q1 → 2026-Q4 in production |
| NDC–HCPCS crosswalks (ASP, OPPS, AWP, PrEP, NOC) | CMS | Quarterly + revisions | 2021-Q1 → 2026-Q4 in production |
| NDC Directory (finished drugs) + excluded listings | FDA | Daily | Clinician-administered Rx + every CMS-crosswalked NDC |
| Purple Book (licensed biologics) | FDA | Monthly | Latest month |
| NCCI Medically Unlikely Edits — practitioner, outpatient hospital, DME supplier | CMS | Quarterly | Current quarter; HCPCS Level II rows only (CPT rows dropped) |
| Drug Products in the Medicaid Drug Rebate Program (data.medicaid.gov) | CMS | Quarterly | Newest quarter for indexed NDCs (unit type, units per package, COD status, termination); the ~330 MB file is streamed and filtered |

Not ingested: CMS OPPS Addendum B (distributed under the AMA CPT license), Medicare Coverage Database content such as covered diagnosis lists (its API requires accepting AMA/ADA/AHA terms limited to personal use, so CodeRx links to it instead), AWP/WAC, commercial payer rates, and all CPT/CDT content. Full catalog with URLs, formats, fields, licensing, and limitations: [`docs/02-data-sources.md`](docs/02-data-sources.md).

Local full load (2026-10-14): **8,770** HCPCS codes (1,322 terminated), **2,306** drugs, **14,795** NDC packages, **668** manufacturers, **9,144** official NDC→HCPCS links, **99** biosimilar→reference links.

## Architecture at a glance

- **Next.js 16** (App Router, React 19, TypeScript, Tailwind CSS v4), server components by default; client JS only for search type-ahead, theme toggle, recent items, copy buttons, and the calculator.
- **PostgreSQL** via **Drizzle ORM** — Neon/any Postgres in production (`DATABASE_URL`), embedded **PGlite** (real Postgres in WASM) for local development and tests. `pg_trgm` powers fuzzy search.
- **Ingestion pipeline** (`src/ingest`): manifest + landing-page discovery → download (timeout, size cap, SHA-256) → ZIP CRC-32 verification → parsers (fixed-width, CSV, TSV, XLSX) → validation → **single-transaction load** → derived tables (drugs, manufacturers, relationships, search index) → import report. Failures roll back and are recorded.
- **Security**: per-request nonce CSP, HSTS and hardening headers, zod validation, parameterized SQL, per-IP rate limiting in `src/proxy.ts`, timing-safe admin/cron tokens, no PHI fields.

Details: [`docs/03-architecture.md`](docs/03-architecture.md) (requirements, user stories, sitemap, routes, components, schema, search, ingestion, refresh, API contracts, security, testing, deployment) and [`docs/04-methodology.md`](docs/04-methodology.md).

## Quick start (local)

Requirements: Node.js ≥ 22 (tested on 24), npm.

```bash
npm install
```

```bash
npm run ingest -- --source all
```

```bash
npm run dev
```

The ingest command downloads the CMS and FDA files (about 60 MB, cached in `.cache/sources`), loads them into a local PGlite database in `.data/pglite`, and builds the search index (≈25 s on a laptop). Open http://localhost:3000.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js development server, production build, production server |
| `npm run lint` · `npm run typecheck` | ESLint (flat config) · `tsc --noEmit` |
| `npm test` | Unit + integration tests (Vitest) |
| `npm run test:unit` · `npm run test:integration` | One project at a time |
| `npm run test:e2e` | Playwright end-to-end, accessibility (axe), and responsive tests |
| `npm run db:generate` · `npm run db:migrate` | Create / apply SQL migrations in `drizzle/` |
| `npm run ingest -- --source <key\|all> [--quarters 8] [--force] [--no-discover]` | Import data |
| `npm run ingest:discover` | List the newest releases on the CMS/FDA pages |
| `npm run ingest -- --derive-only` | Rebuild derived tables and the search index |
| `npm run fixtures -- <raw-dir>` | Regenerate real-data test fixtures from original downloads |
| `npm run audit` | `npm audit --omit=dev` |

Source keys: `cms_hcpcs`, `cms_payment_limits`, `cms_ndc_hcpcs`, `fda_ndc`, `fda_ndc_excluded`, `fda_purple_book`.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | Production | PostgreSQL connection string (Neon pooled URL recommended). Unset locally → PGlite. |
| `CODERX_ADMIN_TOKEN` | Optional | ≥ 32-char secret enabling `POST /api/admin/import`. Unset → endpoint returns 404. |
| `CRON_SECRET` | Production | Secret Vercel Cron sends to `/api/cron/refresh`. |
| `CODERX_FDA_REFRESH_DAYS` | Optional | Minimum days between FDA NDC imports (default 7). |
| `CODERX_MIN_PERIOD` | Optional | Earliest CMS quarter to import, `YYYY-Qn` (default `2021-Q1`). Failed releases older than it are purged on refresh. |
| `NEXT_PUBLIC_SITE_URL` | Optional | Canonical base URL (defaults to the Vercel production domain). |
| `CODERX_PGLITE_DIR` | Local only | PGlite data directory (default `.data/pglite`; `memory://` for tests). |
| `CODERX_DB_POOL_MAX` | Optional | Pool size per instance (default 5). |

See [`.env.example`](.env.example).

## API

All endpoints return `{ data, meta, error }`. Read endpoints are CDN-cacheable (`s-maxage=300`) and rate limited per IP.

| Endpoint | Description |
| --- | --- |
| `GET /api/search?q=` | Ranked results; filters `kind`, `family`, `status`, `manufacturer`, `form`, `route`, `brand`, `biosimilar`, `payment`, `noc`, `effectiveOn`; `sort`, `page`, `pageSize` |
| `GET /api/suggest?q=` | Grouped type-ahead suggestions |
| `GET /api/hcpcs/{code}` | Code detail with history, payments, crosswalk, provenance |
| `GET /api/drugs/{slug}` | Drug detail with products, packages, codes, biosimilars |
| `GET /api/ndc/{ndc}` | NDC detail (any unambiguous format) |
| `GET /api/manufacturers/{id\|slug}` | Labeler with drugs and codes |
| `GET /api/sources` | Every imported release with checksum and dates |
| `GET /api/health` | Database connectivity and data freshness |
| `GET /feeds/changes?codes=` | RSS 2.0 feed of the latest two quarters' changes; `codes` (comma-separated HCPCS) filters to a watchlist |
| `POST /api/audit` | Batch check of up to 500 `{"hcpcs","ndc"}` items against CMS/FDA data (codes and NDCs only; rate limited to 30/min per IP) |
| `POST /api/admin/import` | `Authorization: Bearer $CODERX_ADMIN_TOKEN`; body `{"source":"all","force":false,"latestOnly":true}` |

Example:

```bash
curl -s "https://<your-domain>/api/search?q=0006-3026-02" | jq '.data.hits[0]'
```

## Testing

```bash
npm test
```

```bash
npm run test:e2e
```

- **Unit (95)**: NDC normalization, billing-unit math (including CMS/MAC worked examples), HCPCS families, query parsing, parsers on real CMS/FDA excerpts, ZIP integrity, landing-page discovery, API validation, rate limiting, CSP, derive logic.
- **Integration (44, PostgreSQL via PGlite)**: full ingestion of real fixture releases, provenance, CPT exclusion, history, idempotency, rollback on corrupt or invalid files, re-posted quarters, “no name-based inference” checks, search ranking and the required search scenarios, detail read models, and every API route.
- **End-to-end (48, Playwright on a production build)**: the 15 required journeys, keyboard-only flow, axe-core WCAG 2.x A/AA audits of 11 pages in light and dark themes, responsive checks at 375/768/1440 px, canonical redirects, and security headers.

Fixtures in `tests/fixtures` are unmodified excerpts of the real files; see `tests/fixtures/PROVENANCE.md`. More in [`docs/06-testing.md`](docs/06-testing.md).

## Live deployment

- Production: https://coderxnsl.vercel.app (Vercel project `coderxnsl`, region iad1, Neon Postgres). The earlier addresses `coderx-omega.vercel.app` and `coderx-milotic3005-8754s-projects.vercel.app` redirect here (308, set in `vercel.json`).
- Repository: https://github.com/milotic3005-design/coderx
- Smoke test a deployment: `BASE_URL=https://… npm run test:e2e:prod`

## Deployment (Vercel)

1. Push this repository to GitHub.
2. Import it in Vercel (or `create_git_project`), framework **Next.js**, region `iad1`. `vercel.json` sets the build command (`npm run vercel-build` = migrations + `next build`) and a daily cron.
3. Add **Neon Postgres** from the Vercel Marketplace (Storage → Create Database → Neon) and connect it to the project; it injects `DATABASE_URL`.
4. Add `CRON_SECRET` and `CODERX_ADMIN_TOKEN` (sensitive) in Project → Settings → Environment Variables.
5. Deploy. Migrations run during the build.
6. Load data once, source by source (each call stays within function limits):

```bash
for s in cms_hcpcs cms_payment_limits cms_ndc_hcpcs fda_ndc fda_ndc_excluded fda_purple_book; do
  curl -sS -X POST "https://<your-domain>/api/admin/import" \
    -H "Authorization: Bearer $CODERX_ADMIN_TOKEN" -H "Content-Type: application/json" \
    -d "{\"source\":\"$s\",\"latestOnly\":false}" | jq '.data.outcomes | map({sourceKey, period, status, reason})'
done
```

   Alternatively run `npm run ingest -- --source all` locally with `DATABASE_URL` set to the Neon connection string.
7. Smoke test `/api/health`, a search, a detail page, and the mobile layout.

Operations, refresh schedule, rollback, and manual review: [`docs/05-operations.md`](docs/05-operations.md).

## Dependency audit (2026-10-14)

`npm audit --omit=dev`: **0 vulnerabilities** in runtime dependencies. Development-only findings remain in tooling transitive dependencies (`braces` via `eslint-config-next` → `fast-glob`; `esbuild ≤ 0.24.2` bundled by `drizzle-kit`); neither is shipped to or executed by the deployed app. The unmaintained npm `xlsx` package was deliberately avoided (CodeRx ships a small CRC-checked XLSX reader).

## Known limitations

- No OPPS (hospital outpatient) payment rates; the OPPS **NDC crosswalk** is included.
- CMS crosswalks are not comprehensive; a missing NDC is not evidence that no code applies.
- FDA products whose product-level route is blank (common for kits, e.g. Humira) are indexed only when CMS crosswalks them.
- History: HCPCS from 2023-Q1, payment limits and crosswalks from 2021-Q1 (`CODERX_MIN_PERIOD`); older CMS postings use unsupported formats.
- FDA blocks cloud egress (Vercel, GitHub-hosted runners) for the Purple Book CSV, so a weekly launchd job on an operator's Mac downloads the official file and uploads it to the admin endpoint (see docs/05-operations.md).
- Payer-specific policies, MUEs, LCDs, and 340B are out of scope.
- Rate limiting is per instance; add a Vercel Firewall rate-limit rule for global enforcement.

## License and attribution

Code © the CodeRx authors. Data: CMS and FDA (public domain U.S. Government works). CPT® is a registered trademark of the American Medical Association; no CPT content is included. CodeRx is not affiliated with or endorsed by CMS, FDA, Medicare, or any payer.
