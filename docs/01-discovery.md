# Phase 1 — Discovery: functional analysis and opportunities

_Research date: 2026-10-14. Researcher: CodeRx project (automated agent acting as technical owner)._

This document records what we learned from studying the **publicly accessible
workflows** of BuyAndBill.com as a _functional reference only_, and what we decided
to build differently. No source code, database content, text, branding, page
layout, or visual identity from the reference site was copied. No data from the
reference site was used anywhere in CodeRx.

## Method and boundaries

| Item | What we did |
| --- | --- |
| robots.txt | `User-agent: * / Allow: /` (checked 2026-10-14). |
| Terms of use | Read before browsing. Section 5 prohibits systematic downloading or extraction of site content to build, populate, or improve a competing database, and circumventing rate limits or access controls. Section 7 reserves the design, text, and "the selection and arrangement of its data." |
| Pages viewed | Five public pages, viewed once each, as an ordinary visitor would: home, search, NDC lookup, billing calculator, and one drug page (pembrolizumab). Observations were limited to information architecture and interaction patterns. |
| Data extracted | **None.** Every value in CodeRx comes from CMS or FDA files downloaded directly from the government publishers (see [02-data-sources.md](02-data-sources.md)). |
| Gated content | Not accessed. We did not log in, register, start a trial, or attempt to view locked values. |

## 1. Primary user journeys observed

1. **Drug → code**: a user types a brand or generic name and lands on a code-centric
   drug page (HCPCS code, descriptor, billing unit, NDCs, Medicare payment limit).
2. **Code → drug**: a user enters a HCPCS code (J/Q/C/A/P/S, NOC, CPT vaccine and
   administration codes) and sees the descriptor, products, and payment.
3. **NDC → code**: a user pastes an NDC in any common format and sees the product,
   its billing units per package, and the aligned HCPCS code.
4. **Dose → units → dollars**: a user converts a dose to billing units and estimates
   an allowed amount (office vs. hospital outpatient, optional markup).
5. **Browse**: a user explores codes by family (category pages per letter).
6. **Research / upsell**: biosimilar comparisons, multi-year price history, claims
   analytics, and private-payer rates — largely gated or partner-sourced.

## 2. Search inputs supported

Brand name, generic name, HCPCS code, and NDC (10- or 11-digit; hyphenated 4-4-2,
5-3-2, 5-4-1, and 5-4-2). NDC and HCPCS lookups are offered as separate tools in
addition to a general search page. A separate 10↔11-digit NDC converter exists.

## 3. Search-result organization

The captured search page relies on "popular drug" quick-pick chips (brand + code)
and separate lookup tools; type-ahead and grouped, ranked suggestions were not
evident. Codes are also reachable via per-family category pages. URLs pair the
brand with the code.

## 4. Drug-detail information hierarchy (as observed)

Breadcrumb and title → headline metric cards (several locked) → sticky in-page
anchor navigation → overview key/value fields → short "about" summary → NDC table
(partial; full crosswalk gated) → pricing and reimbursement (history chart and
calculator outputs gated) → partner claims metrics → administration codes →
medically unlikely edits → clinical/indication tags → FAQ → sponsorship notice →
related codes → footer disclaimers.

## 5. Coding and billing tools observed

Billing calculator (units or dose, place of service, markup presets, 80/20 split,
"round partial units up" note), NDC converter, MUE checker, JW/JZ wastage guidance,
self-administered drug exclusion list, place-of-service codes, modifier reference.

## 6. Navigation and information architecture

Mega-menu (search, drug codes, resources, learn, tools, solutions), category pages
per code family, glossary, blog/newsletter, contact/consultation CTAs.

## 7. Mobile and desktop behavior

Collapsible navigation and search menus on small screens; sticky anchor navigation
on detail pages. Promotional overlays appear on several pages.

## 8. Patterns worth adapting (in our own design)

- One universal search box that understands names, codes, and NDCs.
- Tolerance for every common NDC format, with automatic 10→11-digit normalization.
- Code-family browsing and quick access to frequently looked-up codes.
- Billing-unit conversion grounded in the HCPCS dosage descriptor.
- Detail pages with in-page section navigation and related codes.

## 9. What we deliberately do **not** copy or offer

| Not copied / not offered | Reason |
| --- | --- |
| Branding, wording, layout, CSS, imagery, page structure | Original identity required; protected by the reference site's terms. |
| Any data from the reference site, including its "selection and arrangement" | Terms §5/§7; we source directly from CMS/FDA. |
| AWP, WAC, private-payer rates, claims analytics | Licensed or partner data; no lawful public source documented. |
| CPT administration-code descriptors and CPT vaccine descriptors | AMA copyright; CodeRx stores HCPCS Level II only. |
| Usage caps, paywalls, interstitial pop-ups, sponsored content | Conflicts with a calm, trustworthy reference tool. |
| Clinical indication summaries | Would require clinical review of labeling; out of scope (we link to DailyMed instead). |
| Modifier recommendations (JW/JZ) | Requires claim context; we show arithmetic plus educational notes only. |

## 10. Opportunities to build a better experience

1. **Everything public stays public.** CMS payment limits, crosswalks, and history
   are government data; CodeRx shows all of it without login.
2. **Provenance on every section** — source organization, dataset, publication
   date, effective dates, import date, direct file link, and a status badge
   (Official CMS / Official FDA / Derived / Manually reviewed / Historical /
   Verification needed).
3. **Type-ahead with grouped, ranked, explained suggestions** (Drugs, HCPCS codes,
   NDC packages, Manufacturers), fully keyboard operable (WAI-ARIA combobox).
4. **Honest ambiguity handling** — when several drugs match, say so and help the
   user narrow by route, form, or manufacturer instead of guessing.
5. **Quarterly payment history** built from eight CMS quarterly files, with
   revision tracking when CMS re-posts a quarter.
6. **Biosimilar ↔ reference relationships** from the FDA Purple Book, linked by BLA
   number rather than by name similarity.
7. **NOC transparency** — the official CMS NOC code list plus the 2025 CMS NOC
   NDC crosswalk, without ever inventing a product-specific code.
8. **Historical codes** — terminated codes stay searchable, clearly labeled, with
   the CMS cross-reference field shown verbatim.
9. **A calculator that shows its work** — formula, rounding, discarded quantity
   for single-dose containers, and the CMS source of the billing unit.
10. **Accessibility and performance first** — WCAG 2.2 AA, dark mode, minimal client
    JavaScript, no pop-ups, and a documented JSON API.
