# Methodology

The same content is published in the app at `/methodology`. This file records the
rules the code enforces and where each rule lives.

## 1. Principles

| Rule | Enforced in |
| --- | --- |
| Government sources only, downloaded from the publisher | `src/ingest/sources.ts` (manifest), `src/ingest/discover.ts` (accepts only `www.cms.gov` / `www.accessdata.fda.gov` links) |
| NDC → HCPCS only from CMS crosswalk rows | `src/ingest/derive.ts` (`NDC_HCPCS`), integration test “links NDCs to codes only through CMS crosswalk rows” |
| Drug → HCPCS derived from NDC-level rows, labeled **Derived** | `derive.ts` (`DRUG_HCPCS`, `authority: DERIVED`) |
| No name/ingredient inference, no LLM mapping | No such code path exists; test “never infers a code from a shared generic name” (Renflexis vs Remicade) |
| CPT and CDT content never stored | parsers drop CPT/CDT rows and count them in the import report; test “stores no CPT content” |
| Gaps shown as “No authoritative public data was located for this field.” | `SITE.noData`, `NoData` component |
| Conflicts shown, not resolved | duplicate FDA package records render a conflict callout; CMS re-posts are kept as revisions |

## 2. Normalization

- **NDC** (`src/lib/ndc.ts`): hyphenated 4-4-2 → pad labeler; 5-3-2 → pad product; 5-4-1 → pad package; 5-4-2 unchanged; 11 digits unchanged; unhyphenated 10 digits → three candidates (ambiguous, all searched, user told); 8–9 digits → product NDC. A claim-style `N4` prefix and spaces/Unicode dashes are tolerated.
- **HCPCS**: case-insensitive; Level II pattern `^[A-CEG-HJ-MP-V]\d{4}$`.
- **Text** (`src/lib/text.ts`): lowercase, NFKD accent stripping, ® ™ © removed, punctuation → space. Descriptor words that follow a negation (“excludes”, “not”, “non”, …) are not indexed.
- **Manufacturers**: merged only across case, punctuation, and trailing legal suffixes (Inc, LLC, Corp, Co, Ltd, …).
- **Drugs**: FDA products grouped by (proprietary name + suffix, nonproprietary name). Excluded listings missing a nonproprietary name join the single drug with the same brand, if one exists.

## 3. Derived values

| Value | Formula | Badge |
| --- | --- | --- |
| Billing unit (when CMS publishes no dosage column) | last dosage expression in the HCPCS long descriptor; “per i.u.” → 1 IU | Derived |
| Product class | FDA marketing category + Purple Book license type (351(a)/351(k)) | Derived (label explains) |
| Drug → HCPCS | aggregation of CMS crosswalk rows for the drug’s package NDCs; evidence lists the NDCs and quarters | Derived |
| $ per NDC package | billable units per NDC (CMS) × current payment limit (CMS) | Derived |
| Payment change % | quarter-over-quarter difference of published limits | Derived |
| Calculator units | `ceil(dose ÷ unit)`; discarded units for single-dose containers `ceil(opened ÷ unit) − administered` | Derived |

## 4. Payment methodology label

Read only from the CMS file: vaccine/blood AWP % columns, or the CMS “Notes” column
(“AMP-based payment limit”, “WAC”, “lesser of”, “8% of reference add-on applied”);
otherwise “ASP methodology (per CMS file)”. Notes are displayed verbatim. Non-numeric
published limits (e.g. `N/A` for A9606) are stored and shown as published text.

## 5. Search ranking

Tiers (higher first): 100 exact code/NDC · 90 exact brand/generic · 88 exact manufacturer
name · 80 exact alias / abbreviation expansion · 70 prefix · 65 related via crosswalk
(code or NDC queries) · 60 ingredient / descriptor word · 50 manufacturer · 40 all
words matched · 30 trigram fuzzy (similarity ≥ 0.35; dropped when any better match
exists). Order: exact code first, then active before inactive, tier, similarity,
document weight (payment data, coded, package count), title. Ties of ≥ 2 drugs at
tier ≥ 80 mark the query ambiguous.

## 6. Status rules

- HCPCS code active ⇔ no termination date, or termination date ≥ today.
- NDC package active ⇔ in the active FDA directory and marketing end date not passed.
- Drug active ⇔ at least one listed product without a passed marketing end date.
- A release is **current** for its (source, period) until a newer successful release supersedes it; the FDA daily snapshot supersedes all previous snapshots.

## 7. Assumptions

1. Quarterly CMS files apply to the quarter stated in the file header (manifest period is the fallback, and mismatches are reported as warnings).
2. The CMS cross-reference field is shown as a cross-reference, never as a guaranteed replacement code.
3. The FDA NDC Directory scope rule (clinician-administered routes + CMS-crosswalked NDCs) reflects buy-and-bill use; products outside it are reported as “not in the CodeRx index”.
4. Dates are calendar dates without time zones; “today” is evaluated in UTC on the server.
