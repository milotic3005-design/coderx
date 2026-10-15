import { readFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseAspLandingPage, parseHcpcsLandingPage, parsePurpleBookDownloads } from "@/ingest/discover";
import { crosswalkTypeFromFileName, parseCrosswalkCsv } from "@/ingest/parsers/cms-crosswalk";
import { deriveMethodology, parseNotPayableCsv, parsePaymentLimitCsv } from "@/ingest/parsers/cms-payment";
import { parseFdaPackages, parseFdaProducts, parsePurpleBookCsv, splitPharmClasses } from "@/ingest/parsers/fda";
import { parseHcpcsFixedWidth, parseNocCodeRows } from "@/ingest/parsers/hcpcs";
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
});
