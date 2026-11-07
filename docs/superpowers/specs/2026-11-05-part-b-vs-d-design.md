# Part B vs Part D tool: design

Date: 2026-11-05. Status: built and live; section 12 records changes after review.

## 1. Goal

A pharmacist or biller looks up one drug and learns, for each setting, which Medicare benefit pays and what it pays. The operator runs a hospital outpatient department (HOPD) and a home infusion pharmacy that is not a Medicare home infusion therapy (HIT) supplier.

Success means the answer for a real drug matches CMS's own lists, every row cites its source, and the page never states a verdict the data does not support.

Part B and Part D are not interchangeable. A drug is not a Part D drug when Part A or Part B would pay for it "as prescribed and dispensed or administered" (Social Security Act §1860D-2(e)(2)(B); Part D Manual Ch. 6, Appendix C). The tool therefore decides the benefit from the facts first. It compares dollars only between pathways that are lawful for the case.

## 2. Decisions made with the operator

| Question | Decision |
| --- | --- |
| Main answer | Both the benefit verdict and the dollars, equally |
| Part D numbers | CMS quarterly file for Washington plans, plus a contract-rate box that overrides the benchmark and stays in the browser |
| DMEPOS enrollment | Unknown. A page switch defaults to "not enrolled" |
| Approach | Rule engine on CMS data |
| Patient cost share | Out of scope |
| LCD export license | Accepted by the operator on 2026-11-05: drug codes and LCD details only, no CPT, no policy text |

## 3. The page

Route: `/tools/part-b-vs-d`. Card title: "Part B vs Part D".

**Input**
- Drug by HCPCS code, NDC, or name, through the existing search.
- Route, when the code covers more than one.
- Units per dose and doses per month, for the dollars.
- Yes/no questions, shown only when they change the answer (section 6).
- DMEPOS switch, default off, remembered in `localStorage` with a try/catch.
- Contract rate per HCPCS unit (optional, client only, never sent to the server).

**Output**
1. Summary line for the operator's two sites: HOPD and home.
2. Settings table: one row per setting with verdict, reason, and source link with data date.
3. Dollars panel, per dose and per month (section 7).
4. Washington Part D panel: plans listing the drug out of 125, split PDP and MA-PD, with tier range and PA, step therapy, and quantity limit counts.
5. Sources, `ProvenanceFooter`, and the standard `Disclaimer`, plus the line "Guidance only, not a coverage determination."

Add the tool to `TOOLS` in `src/lib/tools.ts` and link it from the drug page's coverage section.

## 4. Data

All sources refresh through `GET /api/cron/refresh`. Each one records a release with checksum and provenance like existing sources.

### 4.1 SAD exclusion lists (extends `cms_mcd_articles`)

The article export's `article_x_code_table.csv` holds the lists for article type 3: 1,522 rows across 8 contractors. Noridian JF (Washington) is A53033 with 190 rows, 22 of them ended. Their code rows are not in `article_x_hcpc_code.csv`.

Tables:
- `mcd_sad_lists`: article id, version, display id, effective date, contractors, states, source release.
- `mcd_sad_entries`: article id, version, row number, HCPCS code, product text, effective date, end date, reasons, route flag, source release.

Parsing rules:
- CPT-like codes are counted and dropped.
- An entry is active when its end date is empty or later than today (U.S. Eastern, `src/lib/dates.ts`).
- Route flag: a trailing `*` means one code with several routes; `**` marks J0801 and J0802. Noridian's article text defines these (JA for IV, JB for subcutaneous; for `**`, JB for subcutaneous and no modifier for IM). Apply this meaning only to Noridian lists A53032 and A53033. Other lists show the product text as written.

### 4.2 DME policy code lists (new source `cms_mcd_lcds`)

Source: `https://downloads.cms.gov/medicare-coverage-database/downloads/exports/current_lcd.zip` (33 MB, weekly), inner `current_lcd_csv.zip`. Read `lcd.csv`, `lcd_x_hcpc_code.csv`, and `lcd_x_contractor.csv`.

Keep active LCDs (status A, contractor type 10) for these policies only, and only codes matching `MCD_DRUG_CODE_RE`:

| Key | LCD | Drug codes (Nov 2026) |
| --- | --- | --- |
| `pump` | L33794 External Infusion Pumps | 43 |
| `ivig` | L33610 Intravenous Immune Globulin | 17 |
| `immunosuppressive` | L33824 Immunosuppressive Drugs | 30 |
| `antiemetic` | L33827 Oral Antiemetic Drugs | 19 |
| `nebulizer` | L33370 Nebulizers | 56 |

Proposed LCDs (status P, such as DL40247) are excluded. Table: `dme_policy_codes` (policy key, LCD id, version, display id, title, HCPCS code, code group, source release).

L33826 (Oral Anticancer) lists only catch-all codes and L38953 (Parenteral Nutrition) lists no drug codes, so both are rules in section 6.

Catch-all codes on a list (J1599, J7799, J7999, J8999, J9999 and similar) give a "check yours" result, not a verdict. Reuse the project's NOC flag where it applies.

### 4.3 Washington Part D (new source `cms_partd_wa`)

Source: data.cms.gov "Quarterly Prescription Drug Plan Formulary, Pharmacy Network, and Pricing Information" (`SPUF_2026_*.zip`, 2.5 GB). Find the newest release in `https://data.cms.gov/data.json` (18 MB). The server supports byte ranges, so read the ZIP directory and fetch only the nested files below. The pharmacy network files, 2.3 GB of the archive, are never downloaded.

| Nested file | Size | Use |
| --- | --- | --- |
| geographic locator | under 0.1 MB | Washington counties and PDP region 30. Match `STATENAME` exactly, so Washington D.C. is excluded |
| plan information | 0.4 MB | Washington plans: `S` contracts in region 30; others by Washington county |
| basic drugs formulary | 8.3 MB | RXCUI, proxy NDC, tier, PA, step, quantity limit, selected drug |
| pricing | 192 MB (2 GB text) | `UNIT_COST` by plan, NDC, days supply |

Measured for 2026 Q3: 125 Washington plans (10 PDP, 115 MA-PD), 32 formularies, about 112,000 formulary rows, 4,912 RXCUIs, about 519,000 Washington 30-day price rows out of 54 million. A full Python pass took 13 seconds plus 19 seconds to download.

Tables:
- `partd_wa_formularies`: formulary id, PDP plan count, MA-PD plan count, source release.
- `partd_wa_formulary_drugs`: formulary id, RXCUI, proxy NDC, tier, PA, step, quantity limit, selected drug, source release.
- `partd_wa_costs`: proxy NDC, RXCUI, plan count, 30-day unit cost minimum, median, maximum, source release.

Formulary rows are stored per formulary because plan counts across a drug's several RXCUIs must be a union. Summing aggregates would double-count plans. Plan names are not needed and are not stored.

The import streams the pricing file and keeps only Washington plans with `DAYS_SUPPLY` 30. It runs last and alone in a refresh. If it exceeds the Vercel limit in practice, fall back to the operator's Mac and an admin upload, matching `scripts/refresh-price-benchmark.ts`.

### 4.4 NDC to RxCUI link (new source `fda_ndc_rxcui`)

Source: `https://download.open.fda.gov/drug/ndc/drug-ndc-0001-of-0001.json.zip` (28 MB). Table `ndc_rxcui`: 9-digit product NDC, RXCUI, source release. Nothing else from the file is kept. Refresh on the same interval as the FDA NDC directory (`CODERX_FDA_REFRESH_DAYS`).

## 5. Linking Part D to a CodeRx drug

The formulary file's NDC is a proxy, one per RxNorm drug. Matching on NDC alone fails: capecitabine and albuterol matched zero. Link by identifiers only, never by name:

1. Exact 11-digit NDC to `partd_wa_formulary_drugs.proxy_ndc`.
2. 9-digit product NDC to the same column.
3. Product NDC through `ndc_rxcui` to RXCUI.

Use the union of RXCUIs from all three. No single method is enough: FDA's file has no RxCUI for Cosentyx or Gammagard, which methods 1 and 2 match; methods 1 and 2 miss ceftriaxone and albuterol, which method 3 matches.

Plans listing the drug = the union of matching formularies, weighted by each formulary's plan counts.

"Not listed" wording: "CMS's formulary file does not list this drug for Washington plans." It must never read as denied. Part D Manual Ch. 6 Appendix C tells sponsors not to list a Part B-covered oral anticancer drug that has no other medically accepted indication, and capecitabine is on 0 of 328 formularies nationally. Other Part B drugs such as rituximab are also absent, for reasons the file does not state. When a drug with no listing also has a Part B pathway, the page shows both facts and does not claim one caused the other.

## 6. Rules

`src/lib/part-b-d.ts` holds a pure function, `decideBenefit(facts, answers)`, with no database access. It returns one result per setting: verdict, reason, source keys, and any billing note. There is no LLM and no name-based logic.

Verdicts: `part_a`, `hospice`, `part_b`, `part_b_packaged`, `part_b_dme`, `part_d`, `not_part_b`, `check`, `not_applicable`.

Every `part_b_dme` result carries the DMEPOS switch's message: "your pharmacy can bill this" or "needs an enrolled DMEPOS supplier; Part D cannot pay because Part B would."

Facts, loaded by `benefitData()` in `src/lib/data/tools.ts`:
- Noridian SAD status: not listed, listed, listed route-specific, or named under a catch-all code.
- How many of the 8 contractors list the code.
- DME policy keys for the code.
- "Drugs Not Payable Under Part B" status (`partBNotPayable`).
- OPPS status indicator and rate; Part B payment limit.
- FDA routes; NOC flag; product type.
- Part D listing and costs.

Settings, each checked top to bottom:

**Inpatient Part A stay.** `part_a`, no separate drug payment. Clotting factors are the exception, paid separately. Note: when Part A days are exhausted or the stay is not covered, Part B or Part D may apply.

**SNF Part A stay.** `part_a`, consolidated billing. Note: certain high-cost chemotherapy is billed separately under Part B.

**Hospice.** `hospice` when related to the terminal illness and for symptom control or pain relief. Note: drugs for an unrelated condition follow the rows below.

**HOPD.**
1. On Drugs Not Payable Under Part B: `not_part_b`.
2. Noridian SAD listed: `not_part_b`. If route-specific: IV is `part_b` with modifier JA, subcutaneous is `not_part_b` with modifier JB, and the page warns that omitting both is denied. For `**` codes: IM is `part_b` with no modifier, subcutaneous is `not_part_b` with JB.
3. Catch-all code with named SAD products: `check`, listing the products.
4. Oral route with no statutory case: `not_part_b`.
5. Status K or G: `part_b`. Status N: `part_b_packaged`. Other or no status: `check`.

**Home, DME pump.**
1. Code on `pump`: `part_b_dme`.
2. Otherwise `not_applicable`; the next row applies.

**Home, no pump.**
1. A statutory case applies: `part_b` or `part_b_dme`.
2. Otherwise `part_d`, drug only. Part D Manual Ch. 6 §10.12: services and supplies for home infusion are never covered under Part D.

**Long-term care, not a Part A stay.** `part_d`, even with a pump or nebulizer (CMS coverage table, March 2018). The same table keeps these under Part B: immunosuppressive, oral anticancer, oral antiemetic, ESA for dialysis, and parenteral nutrition cases. Home IVIG does not apply here.

Statutory cases, with the question shown only when the fact applies:

| Case | Shown when | Result on yes | On no |
| --- | --- | --- | --- |
| Immunosuppressive after a Medicare-covered transplant | Code on `immunosuppressive` | `part_b_dme` | Part D |
| Oral anticancer for cancer, same active ingredient and indication as IV chemotherapy | Oral route, J8 family HCPCS code, not on `antiemetic`, not J8499 | `part_b_dme` | Part D |
| Oral antiemetic within 48 hours of chemotherapy, full replacement for IV | Code on `antiemetic` | `part_b_dme` | Part D |
| Home IVIG for primary immune deficiency | Code on `ivig` | `part_b_dme`, drug only | Next rule |
| Nebulizer drug at home | Code on `nebulizer` | `part_b_dme` | Part D |
| Hemophilia clotting factor, patient self-administers | "Other situations" question | `part_b` | Next rule |
| ESA or ESRD drug for a dialysis patient | "Other situations" question | ESRD bundle, note | Next rule |
| Parenteral nutrition, permanent GI dysfunction | "Other situations" question | `part_b_dme`, prosthetic benefit | Part D |

"Other situations" is a collapsed group because no CMS code list drives it.

Notes shown, not computed:
- **Vaccines**, when the FDA product type is VACCINE: Part B covers influenza, pneumococcal, COVID-19, and hepatitis B (never completed a series, unknown history, or medium or high risk), and some non-preventive vaccines after injury or exposure. Other ACIP-recommended adult vaccines are Part D at no cost to the patient. Vaccines are mostly billed with CPT codes, which CodeRx does not store.
- **Part B-ID**: when the immunosuppressive question appears, note the drug-only benefit for people whose ESRD-based Medicare ended 36 months after transplant.
- **Osteoporosis via home health**: when the code is on no DME list and route is subcutaneous or intramuscular, link to CMS's home health benefit text only if a CMS source for the condition is confirmed during the build. Otherwise omit.
- **Medicare Advantage**: the benefit answer is the same; plan rules and rates differ.
- **Part D exclusions**: weight loss, fertility, cosmetic use, and the other categories in Ch. 6 §20.1 can make a drug non-Part D regardless of setting. Show the current list after confirming it against current CMS text; the 2010 copy of Appendix C is out of date on this.

Every rule cites a key in a `RULE_SOURCES` map with title, section, and URL.

## 7. Dollars

Use the existing logic and do not recalculate it. `src/lib/site-of-care.ts` and `siteOfCareData()` supply the OPPS rate, the payment limit, and sequestration.

| Pathway | Amount |
| --- | --- |
| HOPD, Part B | OPPS payment rate per unit, shown only for status K or G |
| Home, Part B DME | Payment limit per unit, shown only when the row verdict is `part_b_dme` |
| Home, Part D | Median Washington plan unit cost converted to HCPCS units, or the contract rate |

Part B amounts apply 2% sequestration to Medicare's program share and keep the patient share, exactly as `src/lib/site-of-care.ts` does. Part D has no sequestration line.

Conversion: per HCPCS unit = `UNIT_COST × packageSize ÷ billUnitsPerItem`, from the CMS NDC–HCPCS crosswalk row for the matched NDC. Show the comparison only when:
- a crosswalk row exists for that NDC;
- the file's billing unit is confirmed for the product's form (section 10, item 1);
- the result is within 0.25 to 4 times the payment limit.

Otherwise show the raw `UNIT_COST` per NDC unit and the sentence "These units don't convert cleanly, so no dollar comparison is shown." A contract rate per HCPCS unit always allows the comparison.

Mark the higher pathway only when two pathways are lawful for the case, and add: "Site of care is a clinical decision, not a billing choice." When only one pathway is lawful, state that and show no ranking. The panel notes that Part D pays no supplies or nursing and links to `/tools/site-of-care`.

## 8. Missing data and errors

- Unknown code or no indexed drug: "This drug is not in CodeRx" with a note that outpatient oral drugs are usually Part D. No verdict.
- Any missing fact: `No authoritative public data was located for this field.` for that field, and `check` for the row if the rule depends on it.
- Source not yet imported: the affected rows show `check` and name the missing source.
- Import plausibility checks: at least 50 Noridian SAD rows; each of the 5 LCDs present with at least 5 drug codes; at least 50 Washington plans and 1,000 RXCUIs; at least 50,000 `ndc_rxcui` rows. A failed check keeps the prior release.

## 9. Testing

Fixtures are excerpts of real CMS and FDA files, recorded in `tests/fixtures/PROVENANCE.md`.

- Parser unit tests for each new source, including CPT-row dropping, ended SAD rows, proposed LCD exclusion, the D.C. exclusion, and `DAYS_SUPPLY` filtering.
- Golden rule tests on `decideBenefit`:

| Drug | Case | Expected |
| --- | --- | --- |
| Benlysta J0490 | IV, HOPD | `part_b` with JA |
| Benlysta J0490 | Subcutaneous, HOPD | `not_part_b` with JB |
| Benlysta J0490 | Subcutaneous, home | `part_d` |
| Enbrel J1438 | HOPD | `not_part_b` |
| Enbrel J1438 | Home | `part_d` |
| Prolia J0897 | HOPD | `part_b` |
| Prolia J0897 | Home, no pump | `part_d` |
| Treprostinil J3285 | Home, pump, switch off | `part_b_dme`, cannot bill |
| Treprostinil J3285 | Home, pump, switch on | `part_b_dme`, can bill |
| Gammagard J1569 | Home, PID yes | `part_b_dme`, drug only |
| Tacrolimus J7507 | Transplant yes | `part_b_dme` |
| Tacrolimus J7507 | Transplant no | `part_d` |
| Capecitabine J8521 | Cancer yes | `part_b_dme` |
| Albuterol J7613 | Home | `part_b_dme` |
| Albuterol J7613 | Long-term care | `part_d` |
| Any drug | Inpatient Part A | `part_a` |
| J3590 | HOPD | `check` |

- Integration tests for the three-step Part D link and the union plan count.
- E2E tests for the page, the DMEPOS switch, the conditional questions, and that the contract rate is never sent in a request.
- `/tools/part-b-vs-d?code=J0490` in the accessibility page list.
- Production E2E with assertions that do not depend on fixture counts.

## 10. Items to confirm during the build

Each has a default, so none blocks the design.

1. **`UNIT_COST` unit.** Sample data looks per mL for pens and per each for solids, but the file does not label it. Check the 2026 record layout and sample known products. Default: no dollar comparison for any form that cannot be confirmed.
2. **Self-administered drugs in the HOPD.** Confirm CMS's current wording on what the patient can do. Default: say Part B does not pay and show no Part D claim instruction.
3. **Part D Manual currency.** The copy read is Rev. 10 (2010). Prefer the current text. Default: cite only rules also confirmed by a newer CMS source or by statute.
4. **Vercel limits.** The Part D and FDA imports must fit the function's time and memory limits. Default: the operator's Mac plus admin upload.

## 11. Out of scope

- Patient cost share by plan.
- Medicare Advantage contract rates.
- Administration and nursing fees (use `/tools/site-of-care`).
- Plans outside Washington, and pharmacy-network status.
- SNF consolidated billing exclusion lists as data.
- Ordinary oral drugs that CodeRx does not index.

## 12. Changes after the whole-branch review

These amend the sections above, where they differ.

- Section 6: Part D is what remains when nothing else applies, so it needs the drug to be known. A code with no linked product, a catch-all code, or a known vaccine returns `check` at home and in long-term care.
- Section 6: the J8 code family counts as the oral route when no FDA product is linked.
- Section 6: a code on Drugs Not Payable Under Part B returns `check` where a Part B home case would otherwise apply.
- Section 4.1: a SAD entry is active only from its effective date until its end date.
- Section 5: when no identifier links a drug to RxNorm, the page says nothing about Part D rather than "not listed".
- Section 7: a pump-list drug is not priced against Part D. A pathway is marked higher only when it beats the next by more than 1%.
- Section 4.3: the catalog is read at most weekly once a quarter is loaded, and the Part D import runs alone.
- Section 3: a name matching several products offers the codes rather than picking one.
- Rules cite Part D Manual Chapter 6 Rev. 18, not the Rev. 10 copy section 10 names.
- Section 6: an ESRD drug for a dialysis patient is `part_b_packaged`, because the ESRD payment includes it. A home clotting factor is priced at the Part B limit, without the furnishing fee.
- Section 7: home Part B uses the file's coinsurance percentage. An unusable contract rate hides the Part D figure and says so.
