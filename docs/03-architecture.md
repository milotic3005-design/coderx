# Phase 2 — Architecture

## 1. Product requirements

**Product**: CodeRx — _Drug coding and reimbursement intelligence, simplified._

**Goal**: let a healthcare professional enter a brand name, generic name, HCPCS
code (J, Q, C, A, P, S, NOC …), or NDC (any common 10/11-digit format) — or a
manufacturer — and get the most relevant coding, package, billing-unit, and
Medicare reimbursement information available from authoritative public sources,
with provenance on every section.

**Non-goals (MVP)**: claims submission, eligibility, prior authorization,
commercial payer rates, AWP/WAC, clinical decision support, CPT content, user
accounts, storage of any patient information.

**Quality bars**: search response < 500 ms (p95, warm), Lighthouse ≥ 90
performance / ≥ 95 accessibility / ≥ 95 SEO, WCAG 2.2 AA, zero fabricated values.

### Functional requirements

| ID | Requirement |
| --- | --- |
| FR-1 | Universal search accepts brand, generic, HCPCS (any case), NDC (4-4-2, 5-3-2, 5-4-1, 5-4-2, 10/11 digits, with or without hyphens/spaces), product NDC, manufacturer, aliases and common abbreviations. |
| FR-2 | Debounced type-ahead (≤ 150 ms debounce) grouped into Drugs, HCPCS codes, NDC packages, Manufacturers; full keyboard support; recent searches stored only in the user's browser. |
| FR-3 | Ranking: exact code/NDC → exact brand/generic → exact alias → prefix → ingredient → manufacturer → fuzzy → inactive/historical. Every result carries a human-readable match explanation. |
| FR-4 | Results page with summary, count, filters (code family, status, manufacturer, dosage form, route, brand/generic, biosimilar status, effective date, reimbursement availability), sort, pagination. |
| FR-5 | Drug page sections: Overview, HCPCS coding, NDC packages, Billing units, Reimbursement, Related products/codes, Code history, Data sources, Limitations. |
| FR-6 | HCPCS page: family + billing context, descriptors, dates, status, NOC flag, CMS cross-references, payment history, crosswalked NDCs, linked drugs. |
| FR-7 | NDC page: normalized 11-digit NDC, FDA listing (or exclusion status), CMS crosswalk rows by quarter with billing units per package. |
| FR-8 | Billing-unit calculator showing formula, rounding, utilization, discarded quantity (single-dose containers), data source, and verification statement; no modifier recommendations. |
| FR-9 | Provenance block (organization, dataset, publication date, effective dates, import date, link, status badge) on every material data section; explicit "No authoritative public data was located for this field." for gaps. |
| FR-10 | Reproducible ingestion with checksums, validation, transactional load, rollback on failure, import reports; scheduled refresh and secret-protected admin trigger. |
| FR-11 | JSON API with a consistent envelope (data, meta.pagination, meta.match, meta.provenance, error). |

## 2. User stories

1. _As an infusion-center pharmacist_, I type "keytrda" and still get Keytruda and
   J9271 at the top, with the billing unit (1 mg) and the current payment limit.
2. _As a biller_, I paste `0006-3026-02` (10-digit, 4-4-2) and land on the 11-digit
   NDC `00006-3026-02`, its CMS billing units per package, and its HCPCS code.
3. _As a coder_, I enter `j9312` (lowercase) and see the rituximab code, its
   biosimilar Q-codes, and which NDCs CMS crosswalks to each.
4. _As a revenue-cycle analyst_, I see eight quarters of payment limits for a code
   and whether CMS revised any quarter.
5. _As a prior-auth specialist_, I search "dexamethasone" and the app tells me the
   name is ambiguous, groups the matches, and lets me filter by route and form.
6. _As a hospital outpatient coder_, I look up a terminated C-code and see that it
   is historical, its termination date, and the CMS cross-reference.
7. _As a practice manager_, I convert a 200 mg dose of a 10 mg-unit drug from a
   single-dose 100 mg vial and see units, utilization, discarded quantity, and the
   formula — plus a reminder to verify payer rules.
8. _As a payer analyst_, I call `GET /api/hcpcs/J9271` and get JSON with
   provenance for every block.
9. _As a keyboard-only user_, I complete search → result → detail without a mouse.
10. _As an operator_, I trigger `POST /api/admin/import` with a secret and receive
    an import report; a failed import leaves the previous data intact.

## 3. Sitemap and routes

```
/                              Home (search-first)
/search?q=…&filters…           Results (grouped list, filters, sort, pagination)
/drugs/[slug]                  Drug detail            e.g. /drugs/keytruda-pembrolizumab
/hcpcs/[code]                  HCPCS code detail      e.g. /hcpcs/J9271
/ndc/[ndc]                     NDC package detail     any input format → canonical 5-4-2
/manufacturers/[slug]          Manufacturer / labeler
/codes                         Browse code families
/codes/[family]                Codes in a family (paginated, filterable)
/calculator                    Billing-unit calculator (?code=J9271&ndc=…)
/sources                       Data sources and every imported release
/methodology                   Methodology, derivations, limitations, assumptions
/privacy, /terms               Legal
/sitemap.xml, /robots.txt      SEO
```

API (all `GET` unless noted):

```
/api/search?q=&page=&pageSize=&kind=&family=&status=&manufacturer=&form=&route=&brand=&biosimilar=&payment=&effectiveOn=&sort=
/api/suggest?q=                     grouped type-ahead
/api/drugs/[slug]
/api/hcpcs/[code]
/api/ndc/[ndc]
/api/manufacturers/[id]             id = slug or numeric id
/api/sources
/api/health
POST /api/admin/import              Authorization: Bearer $CODERX_ADMIN_TOKEN
GET  /api/cron/refresh              Authorization: Bearer $CRON_SECRET (Vercel Cron)
```

## 4. Component hierarchy

```
RootLayout (fonts, ThemeProvider with CSP nonce, SkipLink, SiteHeader, SiteFooter, Analytics)
├─ HomePage
│  ├─ Hero → SearchCombobox (client) → RecentSearches (client, localStorage)
│  ├─ ExampleQueries · WhatsNewThisQuarter (server) · RecentlyViewed (client)
│  ├─ HowItWorks (3 steps) · FeatureGrid · SourceTransparency (server) · Disclaimer
├─ SearchPage
│  ├─ SearchCombobox · SearchSummary (count, ambiguity notice)
│  ├─ FilterPanel (server-rendered GET form; mobile <details> drawer)
│  ├─ SortControl · ResultList → ResultCard (badges, match explanation) · Pagination
├─ DrugPage / HcpcsPage / NdcPage / ManufacturerPage
│  ├─ PageHeader (title, badges, status) · SectionNav (anchors)
│  ├─ Section (h2 + ProvenanceFooter) × n
│  │   ├─ KeyValueGrid · DataTable (caption, scope, responsive) · PaymentHistoryTable
│  │   ├─ CrosswalkTable · BillingUnitsCard · RelationshipList · CodeHistoryTable
│  ├─ LimitationsCallout · Disclaimer
├─ CalculatorPage → BillingCalculator (client) → FormulaPanel, ResultSummary
└─ SourcesPage → ReleaseTable
Shared: Badge (FamilyBadge, StatusBadge, ProvenanceBadge), EmptyState, ErrorState, Skeleton
```

Server Components by default; client components only for the combobox, recent
items, theme toggle, calculator, and copy-to-clipboard buttons.

## 5. Database schema (PostgreSQL, Drizzle ORM)

Source tables (one row per record per release where history matters):

| Table | Purpose | Key columns |
| --- | --- | --- |
| `source_releases` | Every import attempt | source_key, organization, dataset, period_label, download_url, landing_page_url, publication_date/label, effective_start/end, imported_at, checksum_sha256, byte_size, record_count, status, is_current, report (jsonb), error |
| `hcpcs_codes` | Current HCPCS Level II snapshot | code (pk), family, short/long descriptor, pricing_indicators[], coverage_code, betos, cross_references[], added/action-effective/termination dates, action_code, is_noc, is_drug, first/last_seen_period |
| `hcpcs_code_history` | Quarter-over-quarter changes | code, period, change_type, action_code, descriptors, dates, previous (jsonb) |
| `payment_limits` | Part B payment limits per quarter and release | hcpcs_code, period, effective_start/end, dosage_descriptor, payment_limit, coinsurance_pct, vaccine/blood fields, notes, asp_data_period, methodology |
| `part_b_not_payable` | CMS "Drugs Not Payable Under Part B" | hcpcs_code, period, description, manufacturer |
| `ndc_hcpcs_crosswalk` | CMS crosswalk rows | period, crosswalk_type (ASP/OPPS/AWP/PREP/NOC), hcpcs_code, labeler, ndc_raw, ndc11, drug_name, hcpcs_dosage, package size/qty, bill units per item/package |
| `ndc_products` | FDA product records (listed + excluded subset) | product_id (pk), product_ndc, product_ndc9, names, dosage_form, routes[], marketing dates/category, application_number, labeler, substances[], strengths[], listing_status, exclude_flag, drug_id, manufacturer_id |
| `ndc_packages` | FDA package records | ndc11, package_ndc, product_id, description, marketing dates, listing_status, exclude_flag |
| `biologic_products` | FDA Purple Book products | bla_number, names, license_type, ref product names, dates |

Derived tables (rebuilt after every import, inside the import transaction):

| Table | Purpose |
| --- | --- |
| `manufacturers` | Labelers merged by normalized name; labeler codes |
| `drugs` | One row per (proprietary name, nonproprietary name) group; product class; biosimilar link; codes |
| `drug_aliases` | Brand, generic, ingredient, CMS drug-name, Purple Book proper-name aliases |
| `code_relationships` | NDC_HCPCS (official CMS), DRUG_HCPCS (derived), DRUG_NOC (official CMS NOC crosswalk), BIOSIMILAR_REFERENCE (official FDA), HCPCS_CROSS_REFERENCE (official CMS), manual reviews — each with source, periods, authority, review status, evidence, notes |
| `search_documents` | One per drug, HCPCS code, manufacturer: display + filter columns |
| `search_terms` | Normalized terms per document with term type (btree `text_pattern_ops` + GIN trigram indexes) |
| `import_runs` | Cron/admin/CLI runs with summaries |

Rules: no table has columns for patient data. Numeric money values are stored as
`numeric` exactly as published (3 decimals).

## 6. Search architecture

1. **Parse** the query (`src/lib/search/parse.ts`): trim, NFKD-normalize, cap at
   100 characters; classify as HCPCS code, HCPCS prefix, full NDC (deterministic or
   ambiguous 10-digit), product NDC, labeler code, CPT-like, or text; tokenize text
   and expand curated abbreviations (query expansion only — never used to assign codes).
2. **Code/NDC lookups** go straight to indexed columns (`hcpcs_codes.code`,
   `ndc_packages.ndc11`, `ndc_hcpcs_crosswalk.ndc11`).
3. **Text search** runs one SQL statement over `search_terms`: exact (`=`), prefix
   (`LIKE 'x%'` on `text_pattern_ops`), and fuzzy (`%` trigram operator, recheck
   similarity ≥ 0.35, tokens ≥ 4 chars). Multi-word queries also require every token
   to match some term of the same document.
4. **Rank** in SQL: `exact_code DESC, is_active DESC, tier DESC, similarity DESC,
   weight DESC, title ASC`, tiers = 100 exact code/NDC, 90 exact brand/generic, 88
   exact manufacturer name, 80 exact alias/synonym, 70 prefix, 60 ingredient or
   descriptor word, 50 manufacturer, 40 all-words, 30 fuzzy.
5. **Explain** each hit (`matchType`, matched term, term type).
6. **Ambiguity**: when ≥ 2 drug documents tie at the top tier, the response sets
   `meta.match.ambiguous = true` and the UI shows a refine prompt.

## 7. Data-ingestion pipeline

```
discover (CMS/FDA landing pages) ─┐
manifest (data/source-manifest.json)┴→ fetch (timeout, size cap, UA, retries)
  → integrity (HTTP 200, ZIP central directory, expected entries, SHA-256)
  → skip if checksum already imported (idempotent) unless --force
  → parse (fixed-width / CSV / TSV / XLSX) → normalize codes & NDCs
  → validate (required fields, formats, plausible record counts)
  → BEGIN
      insert source_release(processing) → load rows → diff vs previous release
      → rebuild derived tables → mark release succeeded, supersede older
    COMMIT   (any error → ROLLBACK, then record a failed release with the error)
  → import report (counts, rejected rows with reasons, diff stats, duration)
```

Entry points: `npm run ingest -- --source <key|all>` (CLI), `POST /api/admin/import`,
and `GET /api/cron/refresh` (scheduled). Downloads can be cached in `.cache/sources`
for reproducible local runs.

## 8. Data-refresh strategy

| Source | Publisher cadence | CodeRx check | Import when |
| --- | --- | --- | --- |
| HCPCS | Quarterly | Daily cron reads CMS landing page | New quarter or new checksum |
| Payment limits | Quarterly + revisions | Daily | New quarter or re-posted file (checksum) |
| NDC-HCPCS crosswalks | Quarterly + revisions | Daily | New quarter or checksum |
| FDA NDC (+ excluded) | Daily | Daily `Last-Modified` check | Changed and ≥ `CODERX_FDA_REFRESH_DAYS` (default 7) since last import |
| Purple Book | Monthly | Daily | New month file |

Vercel Hobby allows one cron per day; the job is idempotent and time-boxed.
Heavy initial loads run from the CLI.

## 9. API contracts

Every response:

```json
{
  "data": {},
  "meta": {
    "requestId": "…",
    "generatedAt": "2026-10-14T00:00:00.000Z",
    "pagination": { "page": 1, "pageSize": 20, "total": 42, "totalPages": 3 },
    "match": { "query": "j9271", "queryType": "hcpcs_code", "normalized": "J9271", "ambiguous": false },
    "provenance": [ { "sourceKey": "cms_hcpcs", "organization": "CMS", "dataset": "…", "period": "2026-Q4",
                      "publicationDate": "…", "effectiveStart": "…", "effectiveEnd": "…",
                      "importedAt": "…", "url": "…", "status": "official" } ]
  },
  "error": null
}
```

Errors: `{ "data": null, "meta": {…}, "error": { "code": "INVALID_PARAMETER", "message": "…", "details": [ … ] } }`
with 400 (validation), 401 (admin auth), 404 (not found), 429 (rate limit, with
`Retry-After`), 500/503 (generic message in production).

## 10. Security model

- **No PHI**: no patient fields anywhere; calculator inputs are numbers only;
  recent searches live in the user's own `localStorage` and can be cleared.
- **Validation**: zod schemas on every query/body parameter; length caps.
- **Database**: Drizzle query builder and tagged `sql` templates (parameterized).
- **Rate limiting**: per-IP fixed window in `proxy.ts` for `/api/*` (best effort per
  instance); recommend a Vercel Firewall rate-limit rule for global enforcement.
- **Admin**: `POST /api/admin/import` requires `CODERX_ADMIN_TOKEN` (≥ 32 chars,
  timing-safe compare); disabled when unset. Cron requires `CRON_SECRET`.
- **Headers**: nonce-based CSP (`script-src 'self' 'nonce-…' 'strict-dynamic'`,
  `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`), HSTS,
  `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP.
- **Secrets**: server-only modules (`import 'server-only'`); only `NEXT_PUBLIC_SITE_URL`
  is public. App settings use a `CODERX_` prefix to avoid collisions.
- **Logging**: structured, no query text, no IPs persisted; generic production errors.
- **Dependencies**: `npm audit` in CI; findings documented in the README.

## 11. Testing strategy

| Layer | Tooling | Scope |
| --- | --- | --- |
| Unit | Vitest | NDC normalization, billing math, query parsing, HCPCS families, parsers (on real CMS/FDA excerpts), API validation schemas |
| Integration | Vitest + PGlite (real Postgres in WASM) | migrations, ingestion of fixture releases, idempotency, rollback, search ranking, detail queries, API handlers |
| End-to-end | Playwright (`next start` against a PGlite database seeded from fixtures) | 15 required journeys, keyboard-only flow, mobile/tablet/desktop layouts |
| Accessibility | @axe-core/playwright | WCAG 2.x A/AA rules on every page type |
| Build | `next build`, `tsc --noEmit`, ESLint | must pass |

Fixtures are byte-for-byte excerpts of real CMS/FDA files (header blocks kept), with
provenance recorded in `tests/fixtures/README.md`. No synthetic healthcare values.

## 12. Deployment strategy (Vercel)

- GitHub repository → Vercel project (framework: Next.js, Node 24, region `iad1`).
- Postgres: Neon via the Vercel Marketplace (`DATABASE_URL` injected).
- `npm run db:migrate` runs as part of the build when `DATABASE_URL` is present.
- Initial data load: `npm run ingest -- --source all` from a trusted machine.
- `vercel.json` cron → `/api/cron/refresh` daily.
- Smoke tests against the production URL (search, detail pages, API, mobile).

## 13. Implementation notes (as built)

- **Next.js 16 specifics**: `cacheComponents` is disabled because a per-request CSP nonce requires dynamic rendering, which the Cache Components static shell cannot provide. Middleware is `src/proxy.ts` (Next 16 naming). Read models are cached with `unstable_cache` (tag `coderx-data`, revalidated after imports) and API responses with `s-maxage`.
- **HCPCS storage**: each quarterly file is stored as raw rows in `hcpcs_snapshots`; `hcpcs_codes` (current) and `hcpcs_code_history` (changes) are rebuilt from snapshots, so re-imports and out-of-order backfills cannot corrupt history.
- **Search index**: `search_documents` + `search_terms` (term, term type) with a `text_pattern_ops` b-tree for exact/prefix and a `gin_trgm_ops` index for fuzzy matching; multi-word queries require every token to match the same document.
- **Local database**: PGlite (PostgreSQL 17 in WASM) with `pg_trgm`. Note that `new PGlite(undefined, opts)` ignores `opts.extensions`; CodeRx always passes a data directory or `memory://`.
- **FDA scope**: products with a blank product-level route (common for kits) are indexed only when CMS crosswalks one of their NDCs.
- **Measured search latency** on the full local dataset (PGlite, single process): 1–50 ms for code/NDC/name queries, ≈110 ms for long multi-word queries.
