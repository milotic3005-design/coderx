# Testing

## Commands

```bash
npm run lint && npm run typecheck && npm test && npm run test:e2e && npm run build
```

`npm run test:e2e` seeds `.data/e2e-pglite` from the fixtures, builds the app, starts `next start` on port 3301, and runs Playwright (Chromium). Install the browser once with `npx playwright install chromium`.

## Fixtures

`tests/fixtures/` contains byte-faithful excerpts of the real files downloaded from CMS and FDA on 2026-10-14 (header blocks preserved, multi-line CSV records kept whole). `tests/fixtures/PROVENANCE.md` lists the source file and SHA-256 for each. Regenerate with `npm run fixtures -- <raw-dir>`. No healthcare values are invented; the one “re-posted quarter” test removes a real row rather than altering a value.

## Coverage of the required scenarios

| # | Scenario | Where |
| --- | --- | --- |
| 1 | Exact HCPCS code | `tests/integration/search.test.ts`, `tests/e2e/journeys.spec.ts` |
| 2 | Lowercase HCPCS code | same |
| 3 | Brand name | same |
| 4 | Generic name | same |
| 5 | Formatted 10-digit NDC | same + `tests/unit/ndc.test.ts` |
| 6 | Normalized 11-digit NDC | same |
| 7 | Minor misspelling | same |
| 8 | Active record | `journeys.spec.ts` (J9312) |
| 9 | Inactive historical record | `journeys.spec.ts` (S0189), `search.test.ts` |
| 10 | Billing-unit calculator | `tests/unit/billing.test.ts`, `journeys.spec.ts` |
| 11 | Ambiguous drug name | `search.test.ts`, `journeys.spec.ts` (dexamethasone) |
| 12 | No-result query | same |
| 13 | Missing source data | `detail-and-api.test.ts`, `journeys.spec.ts` (J3490) |
| 14 | Keyboard-only workflow | `journeys.spec.ts` |
| 15 | Mobile / tablet / desktop | `a11y-and-layout.spec.ts` |

### Tools (added 2026-10-15)

| Tool | Where |
| --- | --- |
| CMS MUE ingestion (all three tables, CPT rows dropped) and discovery | `tests/unit/parsers.test.ts`, `tests/integration/pipeline.test.ts` |
| MUE check, claim lines (JW/JZ, `N4` NDC segment), vial optimizer, print worksheet | `tests/unit/calculator-tools.test.ts`, `tests/e2e/tools.spec.ts` |
| Chargemaster audit (pair mismatch, terminated code), margin analyzer (costs not sent), biosimilar comparator, quarterly changes + watchlist | `tests/e2e/tools.spec.ts`, `tests/unit/calculator-tools.test.ts` (margin arithmetic) |
| Coverage links and MUE table on code pages | `tests/e2e/tools.spec.ts` |
| Axe WCAG checks, heading order, and overflow for every `/tools` page | `tests/e2e/a11y-and-layout.spec.ts` |
| At-a-glance strip, sticky record bar, command palette (Ctrl+K, ranking, Escape), tools bento, pinned calculator summary | `tests/e2e/ui.spec.ts` |
| Medicaid rebate product data (streaming parser across chunk boundaries, quarter/scope filter, URL discovery, NDC page, claim qualifier) | `tests/unit/parsers.test.ts`, `tests/integration/pipeline.test.ts`, `tests/e2e/tools2.spec.ts` |
| Vial scanner (GS1 string, UPC, check digits, real DataMatrix photo decoded in the browser), switch simulator, capacity planner, RSS feed | `tests/unit/calculator-tools.test.ts`, `tests/e2e/tools2.spec.ts` |

Also covered: NDC normalization edge cases, parsers for every source format, ZIP corruption and truncation, idempotent re-imports, transactional rollback, CPT exclusion, quarter history, biosimilar linking by BLA, “no name-based inference”, API validation and error envelopes, admin auth, rate limiting, CSP and security headers, axe-core WCAG 2.x A/AA in light and dark themes, heading order, touch targets, table scrolling on small screens.

## Results (2026-10-15)

| Suite | Result |
| --- | --- |
| ESLint | 0 problems |
| `tsc --noEmit` | 0 errors |
| Vitest unit | 129 passed |
| Vitest integration (PGlite PostgreSQL) | 46 passed |
| Playwright E2E + axe + responsive | 83 passed |
| `next build` | succeeded |

## Production smoke test (2026-10-15 UTC)

The same Playwright suite runs against a live deployment with `npm run test:e2e:prod` (`BASE_URL` defaults to the production URL; no local server or seed).

| Target | Result |
| --- | --- |
| https://coderx-milotic3005-8754s-projects.vercel.app (commit `c2c080b`, Neon Postgres) | 48 passed |
| `/api/health` | `ok`; 8,770 HCPCS codes, 2,422 drugs, 67 releases; all six sources current |
| Spot check `/api/hcpcs/J9312` | 24 quarters of payment limits (2021-Q1 → 2026-Q4) |
| https://coderxnsl.vercel.app after the domain move (commit `23cb3f9`) | 48 passed; old `coderx-omega` / `coderx-milotic3005-8754s-projects` hosts return 308 to the same path |
| https://coderxnsl.vercel.app with the tools release (commit `6b6efb1`, MUE tables imported via the admin endpoint) | 66 passed; `/api/health` lists all nine sources current |

An earlier run against commit `2363b7f` had one transient failure in the keyboard-only journey (focus asserted before hydration finished); the test now waits for `networkidle` before tabbing.
