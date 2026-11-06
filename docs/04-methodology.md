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
| Home infusion per diem S-code | therapy category from the FDA Established Pharmacologic Class (EPC) and route, plus the CMS payment-file clotting-factor flag (`src/lib/per-diem.ts`); no name matching; no EPC match → S9379/S9542 by route; FDA routes all non-infused → none; no FDA route listed → all categories considered, none suggested | Derived + Verification needed |
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

## 8. Medicare benefit rules (Part B vs Part D tool)

Part B and Part D are not interchangeable. Under Social Security Act §1860D-2(e)(2)(B), a drug is not a Part D drug when payment for it, as prescribed and dispensed or administered, is available under Part A or B. `src/lib/part-b-d.ts` therefore decides the benefit per setting from CMS facts and the user's answers, and `src/lib/part-b-d-dollars.ts` compares dollars only between pathways that are lawful for the case.

- Facts come from CMS tables: Noridian JF's SAD list (A53033), the DME MAC policy code lists, OPPS status, and Drugs Not Payable Under Part B. Rules cite the Part D Manual Chapter 6 (Rev. 18), the Medicare Benefit Policy Manual Chapter 15 §50.2, and CMS's coverage table (March 2018).
- A rule that needs a source not yet imported, or an answer not yet given, returns "Needs a check". So does a code CMS links to no product, a catch-all code, and a known vaccine. Part D is what remains when nothing else applies, so it needs the drug to be known first.
- Catch-all codes (J3490, J3590, C9399, J7799, and similar) do not decide by code; where Noridian lists products under one, the page shows them.
- Part D coverage says nothing unless a drug links to RxNorm. "Not listed" is shown only when the drug's RxCUI is known and CMS's file does not list it.
- Part D coverage is linked by exact NDC, product NDC, and RxCUI, never by name, and counted as a union of formularies.
- For a pump-list drug, Part D is not priced against Part B: the no-pump row is a different case, not an alternative.
- Part D dollars use each plan's `UNIT_COST`, a retail average, converted by `UNIT_COST × packageSize ÷ billUnitsPerItem`. CMS does not label the unit, so conversion applies only to FDA dosage forms where at least 3 products converted to 0.5 to 2 times the Part B limit (October 2026 sample of 499 NDCs), and only when the result is within 0.25 to 4 times the limit.
- A pathway is marked higher only when it beats the next by more than 1%. Smaller gaps are copay rounding.
