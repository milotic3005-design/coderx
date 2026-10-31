import { readFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { discoverMdrp, mdrpUrl, parseAspLandingPage, parseOppsLandingPage, parseOppsQuarterPage, parseHcpcsLandingPage, parseMueLandingPage, parsePurpleBookDownloads, recentQuarters } from "@/ingest/discover";
import { csvFields, parseMdrpStream } from "@/ingest/parsers/cms-mdrp";
import { mueEffectiveDate, parseMueCsv } from "@/ingest/parsers/cms-mue";
import { crosswalkTypeFromFileName, parseCrosswalkCsv } from "@/ingest/parsers/cms-crosswalk";
import { deriveMethodology, parseNotPayableCsv, parsePaymentLimitCsv } from "@/ingest/parsers/cms-payment";
import { parseFdaPackages, parseFdaProducts, parsePurpleBookCsv, splitPharmClasses } from "@/ingest/parsers/fda";
import { parseHcpcsFixedWidth, parseNocCodeRows } from "@/ingest/parsers/hcpcs";
import { parseOppsAddendumA, parseOppsAddendumB } from "@/ingest/parsers/cms-opps";
import { effectiveDateOf, parseStateFeeSchedule } from "@/ingest/parsers/state-fee-schedule";
import { decodeText } from "@/ingest/text-decode";
import { parseEffectiveRange, parseLongDate, parseUsDate, parseYmd, periodFromMonthYear, quarterBounds } from "@/ingest/values";
import { readFirstSheet } from "@/ingest/xlsx";
import { crc32, unzipVerified, ZipIntegrityError } from "@/ingest/zip";
import { FIXTURE_DIR } from "../helpers/fixtures";

const fixture = (name: string) => decodeText(new Uint8Array(readFileSync(join(FIXTURE_DIR, name)))).text;

describe("value parsing", () => {
  it("parses CMS/FDA date formats", () => {
    expect(parseYmd("20251231")).toBe("2025-12-31");
    expect(parseYmd("20250231")).toBeNull();
    expect(parseLongDate("October 1, 2026")).toBe("2026-10-01");
    expect(parseUsDate("06/30/25")).toBe("2025-06-30");
    expect(parseEffectiveRange("Effective October 1, 2026 through December 31, 2026")).toEqual({ start: "2026-10-01", end: "2026-12-31" });
    expect(periodFromMonthYear("July 2026 NDC-HCPCS Crosswalk")).toBe("2026-Q3");
    expect(quarterBounds("2026-Q1")).toEqual({ start: "2026-01-01", end: "2026-03-31" });
  });
});

describe("HCPCS fixed-width parser (real CMS excerpt)", () => {
  const parsed = parseHcpcsFixedWidth(fixture("hcpcs-2026q4.txt"));
  const byCode = new Map(parsed.records.map((r) => [r.code, r]));

  it("reads every first-line record without rejects", () => {
    expect(parsed.rejected).toEqual([]);
    expect(byCode.size).toBeGreaterThanOrEqual(25);
  });
  it("maps the documented byte positions", () => {
    const j = byCode.get("J9271")!;
    expect(j.longDescription).toBe("Injection, pembrolizumab, 1 mg");
    expect(j.shortDescription).toBe("Inj pembrolizumab");
    expect(j.pricingIndicators).toEqual(["51"]);
    expect(j.addedDate).toBe("2016-01-01");
    expect(j.terminationDate).toBeNull();
  });
  it("captures termination dates for historical codes", () => {
    expect(byCode.get("S0189")?.terminationDate).toBe("2025-12-31");
  });
  it("excludes CDT codes and rejects malformed lines", () => {
    const line = "D0120001003Periodic oral evaluation" + " ".repeat(100);
    const r = parseHcpcsFixedWidth(line);
    expect(r.records).toHaveLength(0);
    expect(r.excludedCdt).toBe(1);
    expect(parseHcpcsFixedWidth("short").rejected).toHaveLength(1);
  });
  it("reads the CMS NOC list spreadsheet", () => {
    const noc = parseNocCodeRows(readFirstSheet(new Uint8Array(readFileSync(join(FIXTURE_DIR, "noc-codes-2026q4.xlsx")))));
    expect(noc.codes.has("J3490")).toBe(true);
    expect(noc.codes.has("J9999")).toBe(true);
    expect(noc.codes.has("C9399")).toBe(true);
    expect(noc.codes.has("J9271")).toBe(false);
  });
});

describe("state Medicaid fee schedule parser (real Washington HCA file)", () => {
  const parsed = parseStateFeeSchedule(readFirstSheet(new Uint8Array(readFileSync(join(FIXTURE_DIR, "wa-hca-home-infusion-20260701.xlsx")))));
  const row = (code: string, modifier: string | null = null) => parsed.rows.find((r) => r.hcpcsCode === code && r.modifier === modifier);
  it("reads the program and effective date from the title block", () => {
    expect(parsed.program).toBe("Home Infusion Therapy/Parenteral Nutrition Program");
    expect(parsed.effectiveDate).toBe("2026-07-01");
    expect(effectiveDateOf("Effective October 1, 2026")).toBe("2026-10-01");
  });
  it("keeps HCPCS Level II rows with every payment area and drops CPT rows", () => {
    expect(parsed.rows).toHaveLength(59);
    expect(parsed.excludedCpt).toBe(2); // 95249, 95250
    expect(parsed.rejected).toEqual([]);
    expect(row("A4221")?.fees.map((f) => f.area)).toEqual(["Non-rural", "Rural", "Seattle CBA", "Vancouver CBA"]);
    expect(row("A4221")?.fees[0]).toEqual({ area: "Non-rural", amount: "24.96", text: "24.96" });
    expect(row("E0781", "RR")?.fees.slice(0, 2).map((f) => f.amount)).toEqual(["298.5", "331.38"]);
  });
  it("keeps text fees as published and trims float noise from amounts", () => {
    expect(row("A4223")?.fees[0]).toEqual({ area: "Non-rural", amount: null, text: "BR*" });
    expect(row("A4927")).toMatchObject({ priorAuth: "PA - Exceptions to Max", comments: "Please see Medical Equipment Fee Schedule for rates" });
    expect(row("B4164")?.fees[0].amount).toBe("18.8947");
    expect(row("B9004", "NU")?.fees[0].amount).toBe("2806.3937");
  });
  it("separates rows by modifier and lists no home infusion per diem S-codes", () => {
    expect(parsed.rows.filter((r) => r.hcpcsCode === "E2102").map((r) => r.modifier)).toEqual(["NU", "RR", "UE"]);
    expect(parsed.rows.some((r) => r.hcpcsCode.startsWith("S"))).toBe(false);
  });
  it("refuses a sheet without the Code and Maximum Allowable Fee header", () => {
    expect(() => parseStateFeeSchedule([["Health Care Authority"], ["Code", "Fee"]])).toThrow(/header row/);
  });
});

describe("Washington HCA professional administered drug fee schedule (real file)", () => {
  const parsed = parseStateFeeSchedule(readFirstSheet(new Uint8Array(readFileSync(join(FIXTURE_DIR, "wa-hca-professional-drugs-20261001.xlsx")))));
  const row = (code: string, modifier: string | null = null) => parsed.rows.find((r) => r.hcpcsCode === code && r.modifier === modifier);
  it("reads the title, the single fee column, and PA flags", () => {
    expect(parsed.program).toBe("Professional Administered Drug Fee Schedule");
    expect(parsed.effectiveDate).toBe("2026-10-01");
    expect(parsed.rows).toHaveLength(1168);
    expect(parsed.excludedCpt).toBe(106);
    expect(row("J9312")).toMatchObject({ statusIndicator: "R", priorAuth: "PA", fees: [{ area: "Statewide", amount: "72.09", text: "72.09" }] });
    expect(row("J1569")).toMatchObject({ priorAuth: null, fees: [{ area: "Statewide", amount: "49.5", text: "49.5" }] });
    expect(row("J0174")?.fees[0]).toEqual({ area: "Statewide", amount: null, text: "AAC" });
  });
  it("splits a modifier written into the code cell and reports duplicate rows", () => {
    expect(row("J3490", "HG")?.fees[0].amount).toBe("15.22");
    expect(row("J3490", "TG")?.fees[0].amount).toBe("59.75");
    expect(parsed.rejected.map((r) => r.reason)).toContain("Duplicate code and modifier J1050");
  });
});

describe("CMS payment limit parser (real excerpt)", () => {
  const parsed = parsePaymentLimitCsv(fixture("payment-2026q4.csv"));
  it("reads the effective period and ASP data quarter from the header block", () => {
    expect(parsed.effectiveStart).toBe("2026-10-01");
    expect(parsed.effectiveEnd).toBe("2026-12-31");
    expect(parsed.aspDataPeriod).toBe("2026-Q2");
  });
  it("drops CPT rows (AMA copyright) and keeps Level II rows as published", () => {
    expect(parsed.excludedCpt).toBeGreaterThanOrEqual(1);
    expect(parsed.rows.some((r) => /^\d/.test(r.hcpcsCode))).toBe(false);
    const j = parsed.rows.find((r) => r.hcpcsCode === "J9271")!;
    expect(j).toMatchObject({ paymentLimit: "62.253", dosageDescriptor: "1 MG", coinsurancePct: "20.000" });
  });
  it("keeps a non-numeric published limit as text instead of coercing it", () => {
    const a = parsed.rows.find((r) => r.hcpcsCode === "A9606")!;
    expect(a.paymentLimit).toBeNull();
    expect(a.paymentLimitText).toBe("N/A");
    expect(a.notes).toMatch(/WAC/);
  });
  it("labels methodology only from the file's own columns and notes", () => {
    expect(parsed.rows.find((r) => r.hcpcsCode === "Q5115")?.methodology).toMatch(/8% of reference/);
    expect(deriveMethodology({ vaccineAwpPct: "95", bloodAwpPct: null, notes: null })).toMatch(/95% of AWP/);
    expect(deriveMethodology({ vaccineAwpPct: null, bloodAwpPct: null, notes: null })).toBe("ASP methodology (per CMS file)");
  });
  it("reads the not-payable list", () => {
    const np = parseNotPayableCsv(fixture("not-payable-2026q4.csv"));
    expect(np.rows.map((r) => r.hcpcsCode)).toContain("J9600");
    expect(np.effectiveStart).toBe("2026-10-01");
  });
});

describe("CMS NDC–HCPCS crosswalk parser (real excerpt)", () => {
  it("classifies crosswalk files by name, tolerating CMS spelling variants", () => {
    expect(crosswalkTypeFromFileName("section 508 verison of April 2026 ASP NDC-HCPCS Crosswalk 033026.csv")).toBe("ASP");
    expect(crosswalkTypeFromFileName("Section 508 Version of October 2026 AWP NDC-HCPCS Crosswalk.csv")).toBe("AWP");
    expect(crosswalkTypeFromFileName("section 508 version of NDC-HCPCS Crosswalk Introduction Text 090326.csv")).toBeNull();
    expect(crosswalkTypeFromFileName("October 2026 ASP NDC-HCPCS Crosswalk 091126.xls")).toBeNull();
  });
  it("normalizes NDCs and keeps bill units as published", () => {
    const x = parseCrosswalkCsv(fixture("crosswalk-asp-2026q4.csv"), "ASP");
    expect(x.effectiveStart).toBe("2026-10-01");
    expect(x.excludedCpt).toBeGreaterThanOrEqual(1);
    const k = x.rows.find((r) => r.ndc11 === "00006302602")!;
    expect(k).toMatchObject({ hcpcsCode: "J9271", billUnitsPerItem: "100", billUnitsPerPackage: "100", hcpcsDosage: "1 MG" });
    expect(x.rows.every((r) => r.hcpcsCode && /^[A-Z]\d{4}$/.test(r.hcpcsCode))).toBe(true);
  });
  it("keeps non-NDC alternate IDs verbatim without normalizing them", () => {
    const csv = "_2025_CODE,Short Description,LABELER NAME,NDC2,Drug Name,HCPCS dosage,PKG SIZE,PKG QTY,BILLUNITS,BILLUNITSPKG\nQ4101,Apligraf,Organogenesis,GG100,Apligraf,1 SQ CM,44,1,44,44\n";
    const x = parseCrosswalkCsv(csv, "ASP");
    expect(x.rows[0]).toMatchObject({ ndcRaw: "GG100", ndc11: null });
    expect(x.alternateIds).toBe(1);
  });
});

describe("CMS MUE table parser (real excerpt)", () => {
  const parsed = parseMueCsv(fixture("mue-practitioner-2026q4.csv"));
  const by = new Map(parsed.rows.map((r) => [r.hcpcsCode, r]));

  it("skips the AMA notice, finds the header, and drops CPT rows", () => {
    expect(parsed.valueColumn).toBe("Practitioner Services MUE Values");
    expect(parsed.excludedCpt).toBe(2);
    expect(parsed.rejected).toEqual([]);
    expect([...by.keys()].every((c) => /^[A-Z]\d{4}$/.test(c))).toBe(true);
  });
  it("keeps values, adjudication indicators, and rationale verbatim", () => {
    expect(by.get("J9312")).toEqual({ hcpcsCode: "J9312", mueValue: 150, adjudicationIndicator: 3, adjudicationText: "3 Date of Service Edit: Clinical", rationale: "Prescribing Information" });
    expect(by.get("J1569")?.mueValue).toBe(400);
  });
  it("reads zero-unit edits (not reportable in that setting)", () => {
    const dme = new Map(parseMueCsv(fixture("mue-dme-2026q4.csv")).rows.map((r) => [r.hcpcsCode, r]));
    expect(dme.get("J2783")?.mueValue).toBe(0);
    expect(dme.get("J1569")?.mueValue).toBe(400);
  });
  it("reads the effective date from the CMS file name", () => {
    expect(mueEffectiveDate("MCR_MUE_PractitionerServices_Eff_10-01-2026.csv")).toBe("2026-10-01");
  });
});

describe("Medicaid Drug Rebate Program product parser (real excerpt)", () => {
  const bytes = new Uint8Array(readFileSync(join(FIXTURE_DIR, "mdrp-products-2026q2.csv")));
  /** Feed the file in small, awkward chunks so records and quoted fields straddle chunk boundaries. */
  async function* chunked(size: number) {
    for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size);
  }

  it("parses quoted fields with commas and doubled quotes", () => {
    expect(csvFields('2026,2,"GENENTECH, INC.",50242005121')).toEqual(["2026", "2", "GENENTECH, INC.", "50242005121"]);
    expect(csvFields('a,"say ""hi""",c')).toEqual(["a", 'say "hi"', "c"]);
  });

  it("keeps only the requested quarter and in-scope NDCs, across chunk boundaries", async () => {
    const all = await parseMdrpStream(chunked(97), { year: 2026, quarter: 2, keep: () => true });
    const scoped = await parseMdrpStream(chunked(4096), { year: 2026, quarter: 2, keep: (n) => n === "50242005121" });
    expect(all.quarterRows).toBe(104);
    expect(all.totalRows).toBe(107);
    expect(all.quartersSeen).toEqual(["2026-Q1", "2026-Q2"]);
    expect(scoped.rows).toHaveLength(1);
    expect(scoped.rows[0]).toMatchObject({
      ndc11: "50242005121",
      labelerName: "GENENTECH, INC.",
      fdaProductName: "RITUXAN (RITUXIMAB)",
      unitType: "ML",
      unitsPerPackage: "10",
      drugCategory: "S",
      drugType: "1",
      codStatus: "02",
      terminationDate: null,
      marketDate: "1997-12-16",
      clottingFactor: false,
      applicationNumber: "0103705",
    });
    expect(all.rejected).toEqual([]);
  });

  it("discovers the newest posted quarter by probing predictable URLs", async () => {
    expect(recentQuarters(new Date("2026-10-16"), 3)).toEqual(["2026-Q4", "2026-Q3", "2026-Q2"]);
    expect(mdrpUrl("2026-Q2")).toBe("https://download.medicaid.gov/data/drugproducts-q2-2026.csv");
    const head = async (url: string) => {
      if (!url.endsWith("q2-2026.csv")) throw new Error("HTTP 404");
      return { lastModified: "Mon, 03 Aug 2026 12:00:00 GMT", etag: null, contentLength: null };
    };
    expect(await discoverMdrp(new Date("2026-10-16"), head)).toEqual([
      { sourceKey: "cms_mdrp_products", period: "2026-Q2", url: mdrpUrl("2026-Q2"), publicationLabel: "Last-Modified Mon, 03 Aug 2026 12:00:00 GMT", publicationDate: "2026-08-03" },
    ]);
  });
});

describe("FDA parsers (real excerpts)", () => {
  it("parses products with multi-value fields", () => {
    const { products, rejected } = parseFdaProducts(fixture("fda-product.txt"));
    expect(rejected).toEqual([]);
    const k = products.find((p) => p.productNdc === "0006-3026")!;
    expect(k).toMatchObject({ proprietaryName: "KEYTRUDA", nonproprietaryName: "pembrolizumab", applicationNumber: "BLA125514", routes: ["INTRAVENOUS"], productNdc9: "000063026" });
    expect(k.strengths).toEqual(["25 mg/mL"]);
  });
  it("normalizes package NDCs to 11 digits", () => {
    const { packages } = parseFdaPackages(fixture("fda-package.txt"));
    expect(packages.find((p) => p.packageNdc === "0006-3026-02")?.ndc11).toBe("00006302602");
  });
  it("reads exclusion flags from the excluded files", () => {
    const { packages } = parseFdaPackages(fixture("fda-packages-excluded.txt"));
    expect(packages.length).toBeGreaterThan(0);
    expect(packages.every((p) => ["E", "U", "I", "D"].includes(p.excludeFlag ?? ""))).toBe(true);
  });
  it("splits pharmacologic classes", () => {
    expect(splitPharmClasses("CD20-directed Cytolytic Antibody [EPC], CD20-directed Antibody Interactions [MoA]")).toEqual([
      "CD20-directed Cytolytic Antibody [EPC]",
      "CD20-directed Antibody Interactions [MoA]",
    ]);
  });
  it("parses the full-list section of the Purple Book", () => {
    const pb = parsePurpleBookCsv(fixture("purplebook.csv"));
    const truxima = pb.rows.find((r) => r.proprietaryName === "Truxima");
    expect(truxima).toMatchObject({ refProperName: "rituximab", refProprietaryName: "Rituxan" });
    expect(truxima?.licenseType).toMatch(/351\(k\)/);
    expect(pb.reportTitle).toMatch(/Purple Book/);
  });
});

describe("ZIP integrity", () => {
  const zip = zipSync({ "a.txt": new TextEncoder().encode("hello world") });
  it("extracts and verifies CRC-32", () => {
    const [e] = unzipVerified(zip);
    expect(new TextDecoder().decode(e.data)).toBe("hello world");
    expect(e.crc32).toBe(crc32(new TextEncoder().encode("hello world")));
  });
  it("rejects a corrupted archive", () => {
    const bad = zip.slice();
    bad[40] ^= 0xff; // flip a byte inside the compressed data
    expect(() => unzipVerified(bad)).toThrow(ZipIntegrityError);
  });
  it("rejects a truncated download", () => {
    expect(() => unzipVerified(zip.slice(0, zip.length - 30))).toThrow(ZipIntegrityError);
  });
});

describe("publisher landing-page discovery", () => {
  it("finds HCPCS quarterly files and their posting labels", () => {
    const html = `<p><a href="/files/zip/october-2026-alpha-numeric-hcpcs-file.zip">October 2026 Alpha-Numeric HCPCS File (ZIP)</a> - Updated 09/23/2026</p>`;
    expect(parseHcpcsLandingPage(html)).toEqual([
      { sourceKey: "cms_hcpcs", period: "2026-Q4", url: "https://www.cms.gov/files/zip/october-2026-alpha-numeric-hcpcs-file.zip", publicationLabel: "Updated 09/23/2026", publicationDate: "2026-09-23" },
    ]);
  });
  it("finds payment and crosswalk files, ignoring off-site links and seasonal vaccines", () => {
    const html = `<p><a href="/files/zip/october-2026-medicare-part-b-payment-limit-files-final.zip">October 2026 Medicare Part B Payment Limit Files</a> – 09/17/2026 - Final file</p>
      <p><a href="/files/zip/july-2026-ndc-hcpcs-crosswalk.zip">July 2026 NDC-HCPCS Crosswalk</a> – 06/17/2026 - Final file</p>
      <p><a href="/files/zip/2026-2027-seasonal-vaccine-price-file.zip">2026-2027 Seasonal Vaccine Price File</a></p>
      <p><a href="https://example.com/files/zip/october-2026-ndc-hcpcs-crosswalk.zip">October 2026 NDC-HCPCS Crosswalk</a></p>`;
    const found = parseAspLandingPage(html);
    expect(found.map((f) => `${f.sourceKey}:${f.period}`)).toEqual(["cms_payment_limits:2026-Q4", "cms_ndc_hcpcs:2026-Q3"]);
    expect(found[0].publicationDate).toBe("2026-09-17");
  });
  it("finds the newest Purple Book monthly file", () => {
    const html = `<a href="https://www.accessdata.fda.gov/drugsatfda_docs/PurpleBook/2026/purplebook-search-August-data-download.csv">CSV</a>
      <a href="https://www.accessdata.fda.gov/drugsatfda_docs/PurpleBook/2026/purplebook-search-September-data-download.csv">CSV</a>`;
    expect(parsePurpleBookDownloads(html).at(-1)?.period).toBe("2026-09");
  });
  it("finds the three MUE tables by file name and ignores the quarterly change files", () => {
    // Shape of the CMS page: the DME link is nested inside a card anchor, so matching is on the href.
    const html = `<a href="/how-look-up-medicare-ncci-medically-unlikely-edits-mues">How to Look Up … Related Downloads
        <a href="/files/zip/medicare-ncci-2026-q4-dme-supplier-services-mue-table.zip">DME Supplier Services MUE Table (ZIP)</a></a> - Effective October 1, 2026; Posted September 1, 2026
      <a href="/files/zip/medicare-ncci-2026-q4-facility-outpatient-hospital-services-mue-table.zip">Facility Outpatient Hospital Services MUE Table (ZIP)</a> - Effective October 1, 2026; Posted September 1, 2026
      <a href="/files/zip/medicare-ncci-2026-q4-practitioner-services-mue-table.zip">Practitioner Services MUE Table (ZIP)</a> - Effective October 1, 2026; Posted September 1, 2026
      <a href="/files/zip/practitioner-services-mue-quarterly-additions-deletions-revisions-10012026.zip">Practitioner Services MUE Quarterly Additions, Deletions, and Revisions (ZIP)</a>`;
    const found = parseMueLandingPage(html);
    expect(found.map((f) => `${f.sourceKey}:${f.period}`).sort()).toEqual(["cms_mue_dme:2026-Q4", "cms_mue_outpatient:2026-Q4", "cms_mue_practitioner:2026-Q4"]);
    expect(found.find((f) => f.sourceKey === "cms_mue_practitioner")).toMatchObject({
      url: "https://www.cms.gov/files/zip/medicare-ncci-2026-q4-practitioner-services-mue-table.zip",
      publicationLabel: "Effective October 1, 2026; Posted September 1, 2026",
      publicationDate: "2026-09-01",
    });
  });
});

describe("CMS OPPS addenda (real October 2026 excerpts)", () => {
  const text = fixture;
  it("Addendum B: HCPCS Level II status indicators and rates, the remedy offset note, no CPT rows", () => {
    const b = parseOppsAddendumB(text("opps-addendum-b-2026q4.txt") + "96413\tChemo iv infusion 1 hr\tS\t5694\t3.6915\t$337.46\t.\t$67.50\r\nD0120\tPeriodic oral eval\tB\r\n");
    expect(b.calendarYear).toBe("CY 2026");
    expect(b.rows).toHaveLength(31);
    expect(b.inpatientDeductible).toBe(1736);
    expect(b.excludedCpt).toBe(1);
    expect(b.excludedDental).toBe(1);
    expect(b.rows.some((r) => /^\d/.test(r.hcpcsCode))).toBe(false);
    expect(b.rows.find((r) => r.hcpcsCode === "J0897")).toEqual({
      hcpcsCode: "J0897",
      apc: "9272",
      statusIndicator: "K",
      relativeWeight: null,
      paymentRate: "29.856",
      nationalCopay: null,
      minimumCopay: "5.98",
      iraCoinsurancePct: "17.885",
      adjustedCopay: "5.34",
      passThroughExpiration: null,
      note: "Inflation-adjusted coinsurance",
    });
    expect(b.rows.find((r) => r.hcpcsCode === "J1100")).toMatchObject({ statusIndicator: "N", paymentRate: null });
    expect(b.remedyOffset).toMatchObject({ ratio: 0.9951, statusIndicators: ["J1", "J2", "P", "Q1", "Q2", "Q3", "R", "S", "S1", "T", "U", "V"] });
  });
  it("Addendum B, July 2026 (comma-delimited 508 copy, drug rates rounded to cents)", () => {
    const b = parseOppsAddendumB(text("opps-addendum-b-2026q3.csv"));
    expect(b.rows).toHaveLength(31);
    expect(b.rows.find((r) => r.hcpcsCode === "J0402")).toMatchObject({ statusIndicator: "G", passThroughExpiration: "*" });
    expect(b.rows.find((r) => r.hcpcsCode === "J9312")).toMatchObject({ statusIndicator: "K", paymentRate: "73.28" });
    expect(b.remedyOffset?.ratio).toBe(0.9951);
  });
  it("Addendum B from spreadsheet rows: full-precision floats and fractional IRA coinsurance", () => {
    // Cells as the July 2026 XLSX stores them (readFirstSheet output).
    const rows = [
      ["", "Addendum B.-- OPPS Payment by HCPCS Code for CY 2026"],
      ["HCPCS Code", "Short Descriptor", "SI", "APC", "Relative Weight", "Payment Rate", "National Unadjusted Copayment", " Minimum Unadjusted Copayment", "IRA Coinsurance Percentage", "Adjusted Beneficiary Copayment", "Drug and Device Pass-Through Expiration during Calendar Year", "Note", "* Indicates a Change"],
      ["J0897", "Denosumab injection", "K", "9272", "", "30.100999999999999", ".", "6.0299999999999994", "0.17326", "5.22", "", "Inflation-adjusted coinsurance", "*"],
      ["J9312", "Inj., rituximab, 10 mg", "K", "9186", "", "73.278000000000006", ".", "14.66", "", "14.66", "", "", "*"],
    ];
    const b = parseOppsAddendumB(rows);
    expect(b.rows.find((r) => r.hcpcsCode === "J0897")).toMatchObject({ paymentRate: "30.101", minimumCopay: "6.03", iraCoinsurancePct: "17.326", adjustedCopay: "5.22" });
    expect(b.rows.find((r) => r.hcpcsCode === "J9312")?.paymentRate).toBe("73.278");
  });
  it("Addendum A: APC rates with CMS group titles", () => {
    const a = parseOppsAddendumA(text("opps-addendum-a-2026q4.txt"));
    expect(a.rows.find((r) => r.apc === "5694")).toMatchObject({ title: "Level 4 Drug Administration", statusIndicator: "S", relativeWeight: "3.6915", paymentRate: "337.46", minimumCopay: "67.5" });
    expect(a.rows.filter((r) => /Drug Administration$/.test(r.title ?? "")).map((r) => r.apc)).toEqual(["5691", "5692", "5693", "5694"]);
    expect(a.remedyOffset?.ratio).toBe(0.9951);
  });
});

describe("OPPS addenda discovery", () => {
  const landing = `<a href="/medicare/payment/prospective-payment-systems/hospital-outpatient-pps/quarterly-addenda-updates/july-2026-addendum"><a href="/medicare/payment/prospective-payment-systems/hospital-outpatient-pps/quarterly-addenda-updates/october-2026-addendum-b">B</a><a href="/medicare/payment/prospective-payment-systems/hospital-outpatient-pps/quarterly-addenda-updates/october-2026-addendum">A</a><a href="/medicare/payment/prospective-payment-systems/hospital-outpatient-pps/quarterly-addenda-updates/april-2026-addendum-q">Q</a>`;
  it("lists each addendum's quarter pages newest first", () => {
    expect(parseOppsLandingPage(landing, "cms_opps_addendum_a").map((p) => p.period)).toEqual(["2026-Q4", "2026-Q3"]);
    expect(parseOppsLandingPage(landing, "cms_opps_addendum_b").map((p) => p.period)).toEqual(["2026-Q4"]);
  });
  it("takes the zip path out of CMS's AMA license link", () => {
    const page = `<li><a href=' https://www.cms.gov/apps/ama/license.asp?file=/files/zip/October-2026-OPPS-Addendum-B.zip'>Addendum B - Updated 10/15/2026</a></li>`;
    expect(parseOppsQuarterPage(page, "2026-Q4", "cms_opps_addendum_b")).toEqual({
      sourceKey: "cms_opps_addendum_b",
      period: "2026-Q4",
      url: "https://www.cms.gov/files/zip/October-2026-OPPS-Addendum-B.zip",
      publicationLabel: "Addendum B - Updated 10/15/2026",
      publicationDate: "2026-10-15",
    });
    expect(parseOppsQuarterPage(page, "2026-Q4", "cms_opps_addendum_a")).toBeNull();
    const july = `<a href='https://www.cms.gov/apps/ama/license.asp?file=/files/zip/july-2026-opps-addendum.zip'>July 2026 OPPS Addendum A - Updated July 21, 2026</a>`;
    expect(parseOppsQuarterPage(july, "2026-Q3", "cms_opps_addendum_a")).toMatchObject({ url: "https://www.cms.gov/files/zip/july-2026-opps-addendum.zip", publicationDate: "2026-07-21" });
  });
});
