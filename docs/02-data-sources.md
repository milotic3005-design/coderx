# Data sources

Every healthcare value shown by CodeRx comes from one of the government datasets
below, downloaded directly from the publisher. Each import is recorded in the
`source_releases` table with its URL, publication label, effective dates, SHA-256
checksum, byte size, record counts, and an import report. The live list is at
`/sources` in the app and `GET /api/sources`.

Verified 2026-10-14 against the publishers' pages. Checksums below are for the
files that were current on that date.

## Summary

| # | Key | Publisher | Dataset | Cadence | Status |
|---|-----|-----------|---------|---------|--------|
| 1 | `cms_hcpcs` | CMS | HCPCS Level II quarterly update (alpha-numeric file + NOC code list) | Quarterly | **Ingested** (2023-Q1 → current) |
| 2 | `cms_payment_limits` | CMS | Medicare Part B Drug Payment Limit File (formerly "ASP Pricing File") + "Drugs Not Payable Under Part B" | Quarterly, with revisions | **Ingested** (2021-Q1 → current) |
| 3 | `cms_ndc_hcpcs` | CMS | NDC–HCPCS crosswalks: ASP, OPPS, AWP, PrEP (and NOC in 2025) | Quarterly, with revisions | **Ingested** (2021-Q1 → current) |
| 4 | `fda_ndc` | FDA | National Drug Code Directory — finished drugs (product + package) | Daily | **Ingested** (scoped) |
| 5 | `fda_ndc_excluded` | FDA | NDC Directory — excluded products/packages | Daily | **Ingested** (NDCs that CMS crosswalks only) |
| 6 | `fda_purple_book` | FDA | Purple Book monthly data download | Monthly | **Ingested** |
| 7 | `cms_mue_practitioner`, `cms_mue_outpatient`, `cms_mue_dme` | CMS | NCCI Medically Unlikely Edit tables (practitioner, facility outpatient hospital, DME supplier) | Quarterly | **Ingested** (current quarter; HCPCS Level II rows only) |
| — | — | CMS | OPPS Addendum B | Quarterly | Evaluated, **not ingested** (AMA license click-through) |
| — | — | FDA | openFDA NDC API | Weekly | Evaluated, not used at runtime |
| — | — | NLM | DailyMed | Daily | Link-out only |

---

## 1. CMS HCPCS Level II quarterly update

| Field | Detail |
| --- | --- |
| Publishing organization | Centers for Medicare & Medicaid Services (CMS) |
| Dataset | HCPCS Quarterly Update — "Alpha-Numeric HCPCS File" |
| Source URL | https://www.cms.gov/medicare/coding-billing/healthcare-common-procedure-system/quarterly-update |
| Example file | https://www.cms.gov/files/zip/october-2026-alpha-numeric-hcpcs-file.zip (SHA-256 `08c2202f…5992f`) |
| Format | ZIP containing a fixed-width TXT (320-byte records, CRLF), XLSX copy, record layout, NOC code list (XLSX), processing notes, transaction report, corrections |
| Update frequency | Quarterly (January, April, July, October), occasionally re-versioned (`_v2`, `_v3` …) |
| Effective date | First day of the quarter; each record also carries add date, action-effective date, and termination date |
| Licensing / restrictions | HCPCS Level II codes and descriptors are maintained by CMS and are public. CPT (Level I) is AMA-copyrighted and is **not** in this file; CDT (D-codes) is ADA-copyrighted — CodeRx drops any D-code it encounters (none present in 2025–2026 files). |
| Fields used | code, record id (3 = first line, 4 = continuation), long/short descriptor, up to 4 pricing indicators, multiple-pricing indicator, up to 5 cross-reference codes, coverage code, processing note, BETOS, type of service, add date, action-effective date, termination date, action code; NOC flag from the companion list |
| Known limitations | No NDC information. A valid code is not necessarily payable. Cross-reference codes are "an explicit reference crosswalking a deleted code or a code that is not valid for Medicare to a valid current code (or range of codes)" — not a guaranteed 1:1 replacement, so CodeRx labels them as CMS cross-references. History is limited to the quarters ingested. |
| Ingestion | Download ZIP → select `HCPC####_MMM_ANWEB*.txt` → parse by byte position from the record layout → append continuation lines to the long descriptor → read NOC list → upsert current code table → write per-quarter change history (added / descriptor changed / terminated / reactivated). |

## 2. CMS Medicare Part B drug payment limit file

| Field | Detail |
| --- | --- |
| Publishing organization | CMS |
| Dataset | Medicare Part B Drug Payment Limit File (named "ASP Pricing File" through 2025) and "Drugs Not Payable Under Part B" |
| Source URL | https://www.cms.gov/medicare/payment/part-b-drugs/asp-pricing-files |
| Example file | https://www.cms.gov/files/zip/october-2026-medicare-part-b-payment-limit-files-final.zip — posted "09/17/2026 - Final file" (SHA-256 `a9b7afa8…c417`) |
| Format | ZIP with XLS and a Section 508 CSV (header block, then a table) |
| Update frequency | Quarterly; prior quarters are re-posted when revised (e.g., "Final file - revised 09/15/2026") |
| Effective date | Stated in the file ("Effective October 1, 2026 through December 31, 2026"); payment limits under the ASP methodology are based on ASP data from two quarters earlier (e.g., "based on 2Q26 ASP data") |
| Licensing / restrictions | U.S. Government work. The file also lists CPT vaccine/immune-globulin codes whose descriptors are AMA-copyrighted; **CodeRx excludes all CPT rows** and records the excluded count in the import report. |
| Fields used | HCPCS code, short description, HCPCS code dosage (billing unit), payment limit, co-insurance percentage, vaccine AWP %, vaccine limit, blood AWP %, blood limit, clotting factor, notes |
| Known limitations | CMS: "The absence or presence of a HCPCS code and the payment allowance limits in this table does not indicate whether Medicare covers a drug." MACs may price drugs not on the file (including NOC drugs). Payment limits are national limits before deductible, coinsurance, and sequestration. Not an OPPS rate file. |
| Ingestion | Download ZIP → choose the Section 508 CSV whose name matches "payment limit"/"ASP pricing" → locate the header row → parse effective period and ASP data quarter from the header block → validate numeric fields → upsert per (code, quarter, release) → compare with the previous release of the same quarter to flag revisions. |

## 3. CMS NDC–HCPCS crosswalks

| Field | Detail |
| --- | --- |
| Publishing organization | CMS, Division of Data Analysis and Market Based Pricing |
| Dataset | ASP NDC-HCPCS Crosswalk; OPPS NDC-HCPCS Crosswalk; AWP NDC-HCPCS Crosswalk (vaccines and blood products paid on AWP); PrEP NDC-HCPCS Crosswalk; NOC NDC-HCPCS Crosswalk (published in 2025 packages only) |
| Source URL | https://www.cms.gov/medicare/payment/part-b-drugs/asp-pricing-files |
| Example file | https://www.cms.gov/files/zip/october-2026-ndc-hcpcs-crosswalk-final.zip — "09/17/2026 - Final file" (SHA-256 `e6bbf7c6…5ab1`) |
| Format | ZIP with XLS/XLSX and Section 508 CSVs |
| Update frequency | Quarterly, with revisions |
| Effective date | Stated in each file ("Effective October 1, 2026 through December 31, 2026") |
| Licensing / restrictions | U.S. Government work; CPT-coded rows are excluded by CodeRx (AMA copyright). |
| Fields used | HCPCS code, short descriptor, labeler name, NDC (11-digit 5-4-2) or alternate ID, drug name, HCPCS dosage, package size, package quantity, billable units per item, billable units per 11-digit NDC |
| Known limitations | CMS: the crosswalks "support ASP-based Medicare Part B payments only" and "are not intended to be a comprehensive list of all drugs/NDCs available in the United States." An NDC missing from the crosswalk is **not** evidence that it has no HCPCS code. |
| Ingestion | Download ZIP → classify each CSV by type → locate header → normalize NDCs → keep alternate IDs verbatim (no NDC normalization) → store per (release, type, code, NDC). These rows are the **only** basis CodeRx uses for NDC-to-HCPCS relationships. |

## 4. FDA National Drug Code Directory (finished drugs)

| Field | Detail |
| --- | --- |
| Publishing organization | U.S. Food and Drug Administration (FDA), CDER |
| Dataset | NDC Directory — text version (`product.txt`, `package.txt`) |
| Source URL | https://www.fda.gov/drugs/drug-approvals-and-databases/national-drug-code-directory → https://www.accessdata.fda.gov/cder/ndctext.zip |
| Format | ZIP of two tab-delimited files (`product.txt` is Latin-1 encoded; `package.txt` is UTF-8) |
| Update frequency | Daily (file of 2026-10-14: `Last-Modified: Wed, 14 Oct 2026 08:15:27 GMT`, SHA-256 `1b018f00…6d74`) |
| Effective date | Snapshot date of the file |
| Licensing / restrictions | Public U.S. Government data. FDA: inclusion "does not indicate that FDA has verified the information," does not denote approval, and does not establish coverage or reimbursement. |
| Fields used | product ID, product NDC, product type, proprietary name and suffix, nonproprietary name, dosage form, route(s), marketing start/end, marketing category, application number, labeler, substance names, strengths and units, pharmacologic classes, DEA schedule, listing certified-through date; package NDC, description, marketing start/end, sample flag |
| Known limitations | Labeler-submitted. Discontinued products leave this file (see #5). Package NDCs are 10-digit in varied segment layouts and must be normalized to 11 digits. A small number of package NDCs appear under more than one product record; CodeRx shows all of them rather than picking one. |
| Scope in CodeRx | Products of type Human Prescription Drug, Plasma Derivative, Vaccine, or Cellular Therapy with at least one clinician-administered route (intravenous, subcutaneous, intramuscular, intravitreal, intrathecal, implantation, etc.), **plus every product that has a package in any ingested CMS crosswalk** (covers oral anticancer and inhalation drugs). Oral/topical products without a CMS crosswalk entry are out of scope and the UI says so. |
| Ingestion | Download → stream lines → decode per file → filter to scope → normalize NDCs → replace the current FDA snapshot in one transaction. |

## 5. FDA NDC Directory — excluded products

| Field | Detail |
| --- | --- |
| Publishing organization | FDA, CDER |
| Dataset | "NDC excluded drugs database file" |
| Source URL | https://www.accessdata.fda.gov/cder/ndc_excluded.zip |
| Format | ZIP of tab-delimited `Products_excluded.txt`, `Packages_excluded.txt` (+ XLS copies) |
| Update frequency | Daily |
| Licensing / restrictions | Public U.S. Government data |
| Fields used | Same layout as #4 plus `NDC_EXCLUDE_FLAG`: **E** removed for failure to respond to FDA requests for corrections; **U** listing certification expired; **I** inactivated by FDA; **D** discontinued by the firm |
| Known limitations | Many fields are blank on excluded records. |
| Scope in CodeRx | Only packages whose NDC appears in an ingested CMS crosswalk — so CodeRx can explain why a CMS-crosswalked NDC is no longer in the active directory. |

## 6. FDA Purple Book (licensed biological products)

| Field | Detail |
| --- | --- |
| Publishing organization | FDA (CDER and CBER) |
| Dataset | Purple Book: Database of Licensed Biological Products — monthly data download |
| Source URL | https://purplebooksearch.fda.gov/downloads → e.g. https://www.accessdata.fda.gov/drugsatfda_docs/PurpleBook/2026/purplebook-search-September-data-download.csv |
| Format | CSV with a "changes this month" section followed by the full product list (same header) |
| Update frequency | Monthly (September 2026 file `Last-Modified: 30 Sep 2026`, SHA-256 `b9d04a8b…74e6`) |
| Licensing / restrictions | Public U.S. Government data |
| Fields used | BLA number, applicant, proprietary name, proper name, license type (351(a), 351(k) Biosimilar, 351(k) Interchangeable), strength, dosage form, route, presentation, marketing status, licensure, approval dates, reference product proper and proprietary names |
| Known limitations | Relationships are product-level; CodeRx links them to NDC products only through the BLA number in the FDA NDC Directory's application-number field, never by name similarity. |
| Ingestion | Download → parse the last header section → store products → derive biosimilar → reference links. |

## 7. CMS NCCI Medically Unlikely Edits (MUE) tables

| Field | Detail |
| --- | --- |
| Publishing organization | CMS (National Correct Coding Initiative) |
| Dataset | Medicare NCCI MUE tables: Practitioner Services, Facility Outpatient Hospital Services, DME Supplier Services |
| Source URL | https://www.cms.gov/medicare/coding-billing/national-correct-coding-initiative-ncci-edits/medicare-ncci-medically-unlikely-edits → e.g. https://www.cms.gov/files/zip/medicare-ncci-2026-q4-practitioner-services-mue-table.zip |
| Format | ZIP with `MCR_MUE_<Type>Services_Eff_MM-DD-YYYY.csv` (and an XLSX copy); the CSV starts with the AMA CPT copyright notice, then a header row |
| Update frequency | Quarterly (2026-Q4 tables effective October 1, 2026, posted September 1, 2026). Plain download — no license click-through |
| Licensing / restrictions | U.S. Government work. The tables mix CPT codes (AMA copyright); CodeRx keeps only HCPCS Level II rows and counts the dropped CPT rows in the import report |
| Fields used | HCPCS code, MUE value (max units of service per patient per date of service), MUE adjudication indicator (1 line edit, 2 date-of-service policy, 3 date-of-service clinical), MUE rationale |
| Known limitations | CMS keeps some MUE values confidential; a missing value is not evidence that no limit exists. A value of 0 means the code is not reportable in that setting. Medicare fee-for-service only. |
| Ingestion | Discovered on the MUE page by file name (the page nests its links); each table is its own source key so the three settings keep separate release histories. 2026-Q4: 4,549 practitioner, 4,500 outpatient hospital, 3,109 DME supplier HCPCS rows. |

## Evaluated but not ingested

| Source | Why not (yet) |
| --- | --- |
| **CMS OPPS Addendum B** (hospital outpatient payment rates and status indicators) | The download link routes through CMS's AMA CPT license click-through (`/apps/ama/license.asp?file=…October-2026-OPPS-Addendum-B.zip`). Accepting that license is a decision for the operator, and the file mixes CPT content that cannot be redistributed. CodeRx shows "No authoritative public data was located for this field" for OPPS rates and links to the CMS addenda page. The OPPS **NDC-HCPCS crosswalk** (#3) is ingested. |
| **CMS NOC pricing file** | Published as a separate file through October 2025; the 2026 payment-limit packages contain no NOC pricing file. NOC drugs are priced by MACs. |
| **openFDA NDC API** | Same content as the bulk directory; the app must not depend on slow real-time government APIs, so bulk files are used. |
| **Drugs@FDA, DailyMed** | Useful for labeling; CodeRx links out to DailyMed by NDC instead of storing labels. |
| **Medicare Coverage Database (LCDs, NCDs, Billing & Coding articles, SAD exclusion lists)** | The CMS Coverage API returns these only with a token obtained by accepting the AMA, ADA, and AHA license agreements, which limit use to personal, non-commercial display — so covered-diagnosis lists cannot be republished on a public site. CodeRx links each code and drug to the official MCD search, SAD exclusion report, and MAC directory instead. |
| **AWP, WAC, commercial payer rates, compendia** | Licensed; excluded by policy. |

## Data-handling rules (enforced in code)

1. CodeRx never infers a HCPCS code from a name, ingredient, or NDC similarity.
   NDC→HCPCS relationships come only from CMS crosswalk rows; drug→HCPCS links are
   derived from those NDC-level rows and labeled **Derived**.
2. CPT and CDT content is never stored.
3. Every derived number (per-package payment, units, utilization) is labeled as a
   derived calculation and shows its formula.
4. Missing values render as "No authoritative public data was located for this
   field." — never as a substitute value.
5. Conflicts (e.g., the same package NDC under two FDA product records, or a
   quarter re-posted with a different payment limit) are shown, not resolved silently.
