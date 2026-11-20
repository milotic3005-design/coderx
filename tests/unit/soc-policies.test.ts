/** Payer site-of-care readers, on short excerpts that copy each payer's real layout (pdf.js text). */
import { describe, expect, it } from "vitest";
import {
  quoteInText,
  criteriaFingerprint,
  criteriaSection,
  diffEntries,
  htmlText,
  parseAetnaXml,
  parseDate,
  parsePremeraCodes,
  parseRegenceTable,
  parseUhcCodeList,
  policyFacts,
  premeraFutureLinks,
  premeraUpdatePages,
  SOC_PAYER_KEYS,
  socUploadSchema,
} from "@/ingest/soc-policies";
import { SOC_RULES } from "@/lib/soc/rules";

describe("dates", () => {
  it("reads the payers' date styles", () => {
    expect(parseDate("Effective Date: October 1, 2026")).toBe("2026-10-01");
    expect(parseDate("Nov. 6, 2026")).toBe("2026-11-06");
    expect(parseDate("Sept. 1, 2026")).toBe("2026-09-01");
    expect(parseDate("6/15/2026")).toBe("2026-06-15");
    expect(parseDate("4/1/26")).toBe("2026-04-01");
    expect(parseDate("someday")).toBeNull();
  });
});

describe("UnitedHealthcare code list", () => {
  const text = [
    "CPT/HCPCS",
    "Code Brand Name Code Description Applicable Policy",
    "90283 N/A – Administration Immune globulin (IgIV), human, for",
    "J0129 Orencia® (abatacept) Injection, abatacept, 10 mg (code",
    "J0180 Fabrazyme® (agalsidase",
    "beta)",
    "Injection, agalsidase beta, 1 mg Intravenous Enzyme",
    "J9022* Tecentriq® (atezolizumab) Injection, atezolizumab, 10 mg Oncology Medication Clinical",
  ].join("\n");
  it("keeps HCPCS rows with the brand and generic, joins wrapped names, marks oncology stars, and skips CPT", () => {
    expect(parseUhcCodeList(text)).toEqual([
      { code: "J0129", label: "Orencia (abatacept)", addedDate: null, oncologyStar: false, homeInfusionEligible: null },
      { code: "J0180", label: "Fabrazyme (agalsidase beta)", addedDate: null, oncologyStar: false, homeInfusionEligible: null },
      { code: "J9022", label: "Tecentriq (atezolizumab)", addedDate: null, oncologyStar: true, homeInfusionEligible: null },
    ]);
  });
});

describe("Premera codes", () => {
  it("reads one entry per code in CMS descriptor wording", () => {
    const text = "Code Description\nJ0129 Injection, abatacept (Orencia)\nJ1745 Injection, infliximab, excludes biosimilar, 10 mg\nJ0129 Injection, abatacept (Orencia)\nSee J1745 above";
    expect(parsePremeraCodes(text).map((e) => [e.code, e.label])).toEqual([
      ["J0129", "Injection, abatacept (Orencia)"],
      ["J1745", "Injection, infliximab, excludes biosimilar, 10 mg"],
    ]);
  });
});

describe("Regence Appendix 1", () => {
  const text = [
    "Appendix 1: Medications Included in the Infusion Drug Site of Care Program",
    "Medication Effective Date Policy Number",
    "Home",
    "infusion",
    "eligible b",
    "HCPCS Code",
    "Actemra, tocilizumab a 3/1/2015 dru444,",
    "dru900 (UMP) Yes J3262",
    "Aralast NP, alpha-1 proteinase",
    "inhibitor 10/1/2024 dru382 Yes J0256",
    "© 2026 Regence. All rights reserved.",
    "dru408.39 Page 12 of 17",
    "Example drug, testmab 1/1/2027 dru999 No J9999, Q9999",
    "Appendix 2: Approved sites",
  ].join("\n");
  it("reads wrapped rows with the date each drug came under review and its home infusion column", () => {
    expect(parseRegenceTable(text)).toEqual([
      { code: "J3262", label: "Actemra, tocilizumab", addedDate: "2015-03-01", oncologyStar: false, homeInfusionEligible: "Yes" },
      { code: "J0256", label: "Aralast NP, alpha-1 proteinase inhibitor", addedDate: "2024-10-01", oncologyStar: false, homeInfusionEligible: "Yes" },
      { code: "J9999", label: "Example drug, testmab", addedDate: "2027-01-01", oncologyStar: false, homeInfusionEligible: "No" },
      { code: "Q9999", label: "Example drug, testmab", addedDate: "2027-01-01", oncologyStar: false, homeInfusionEligible: "No" },
    ]);
  });
});

describe("Aetna drug therapies", () => {
  it("reads names, the date each joined the policy, and when the list was generated", () => {
    const xml = `<document date-generated="Mon Aug 24 14:47:36 UTC 2026"><header><drug-name><![CDATA[Drug name]]></drug-name></header>
<row row-index="1"><drug-name><![CDATA[Osenvelt]]></drug-name><alpha><![CDATA[O]]></alpha><effective-date><![CDATA[10/1/26]]></effective-date></row>
<row row-index="2"><drug-name><![CDATA[Orencia IV formulation]]></drug-name><effective-date><![CDATA[1/1/19]]></effective-date></row></document>`;
    expect(parseAetnaXml(xml)).toEqual({
      generated: "2026-08-24",
      entries: [
        { code: null, label: "Osenvelt", addedDate: "2026-10-01", oncologyStar: false, homeInfusionEligible: null },
        { code: null, label: "Orencia IV formulation", addedDate: "2019-01-01", oncologyStar: false, homeInfusionEligible: null },
      ],
    });
  });
});

describe("criteria wording", () => {
  const policy = (extra = "") =>
    ["Coverage Rationale ............ 1", "Definitions ............ 2", "Coverage Rationale", "Initial infusion for a short duration of time (e.g., 4 weeks); or", "Provider Administered Drugs – Site of Care Page 2 of 7", `Prior severe reaction.${extra}`, "Ongoing infusion will be no more than 6 months.", "Note: greatest period allowed.", "Definitions", "Oncology Drugs: …"].join("\n");
  it("takes the criteria section, skipping the table of contents and page furniture", () => {
    const section = criteriaSection("uhc", policy())!;
    expect(section.split("\n")[0]).toBe("Coverage Rationale");
    expect(section).not.toMatch(/Page 2 of 7|Oncology Drugs/);
  });
  it("gives the same fingerprint when only spacing changes, and a new one when the words change", () => {
    const a = criteriaFingerprint(criteriaSection("uhc", policy())!);
    expect(criteriaFingerprint(criteriaSection("uhc", policy().replace("short duration", "short   duration"))!)).toBe(a);
    expect(criteriaFingerprint(criteriaSection("uhc", policy(" Or age under 19."))!)).not.toBe(a);
  });
  it("is null when the layout moved", () => {
    expect(criteriaSection("premera", "No such heading")).toBeNull();
  });
  it("reads effective dates and policy numbers", () => {
    expect(policyFacts("uhc", "Policy Number: 2026D0121X\nEffective Date: October 1, 2026")).toMatchObject({ policyNumber: "2026D0121X", effectiveDate: "2026-10-01" });
    expect(policyFacts("premera", "Effective Date: Nov. 6, 2026")).toMatchObject({ effectiveDate: "2026-11-06" });
    expect(policyFacts("cigna", "Effective Date………………. 6/15/2026")).toMatchObject({ effectiveDate: "2026-06-15", policyNumber: "1605" });
  });
  it("turns an HTML page into one line per block", () => {
    expect(htmlText("<p>Criteria for medical need</p><script>x()</script><li>Up to&nbsp;45 days</li>")).toBe("Criteria for medical need\nUp to 45 days");
  });
});

describe("Premera versions posted ahead", () => {
  it("checks this month's and the next two months' update pages", () => {
    expect(premeraUpdatePages(new Date("2026-11-19T00:00:00Z"))).toEqual([
      "https://www.premera.com/wa/provider/news/medical-policies/policy-updates/november-2026/",
      "https://www.premera.com/wa/provider/news/medical-policies/policy-updates/december-2026/",
      "https://www.premera.com/wa/provider/news/medical-policies/policy-updates/january-2027/",
    ]);
  });
  it("finds dated 11.01.523 links once each", () => {
    const html = '<a href="/medicalpolicies/11.01.523_2027-02-01.pdf">x</a><a href="/hmo/medicalpolicies/11.01.523_2027-02-01.pdf">y</a><a href="/medicalpolicies/11.01.523_2027-02-01.pdf">z</a>';
    expect(premeraFutureLinks(html)).toEqual([{ url: "https://www.premera.com/medicalpolicies/11.01.523_2027-02-01.pdf", effectiveDate: "2027-02-01" }]);
  });
});

describe("changes and uploads", () => {
  it("reports drugs added and removed between two lists", () => {
    const before = [{ code: "J0129", label: "Orencia" }, { code: "J1745", label: "Remicade" }];
    const after = [{ code: "J0129", label: "Orencia", addedDate: null }, { code: "J9022", label: "Tecentriq", addedDate: "2027-01-01" }];
    expect(diffEntries(before, after)).toEqual({ added: [{ code: "J9022", label: "Tecentriq", addedDate: "2027-01-01" }], removed: [{ code: "J1745", label: "Remicade" }] });
  });
  it("accepts only the payer's own hosts and needs a policy document", () => {
    const doc = { role: "policy" as const, url: "https://www.premera.com/medicalpolicies/11.01.523.pdf", title: "x", policyNumber: null, effectiveDate: null, sha256: "a".repeat(64), criteriaText: "x", criteriaHash: "b".repeat(16), entries: [] };
    expect(socUploadSchema.safeParse({ payerKey: "premera", sha256: "c".repeat(64), documents: [doc] }).success).toBe(true);
    expect(socUploadSchema.safeParse({ payerKey: "premera", sha256: "c".repeat(64), documents: [{ ...doc, url: "https://example.com/x.pdf" }] }).success).toBe(false);
    expect(socUploadSchema.safeParse({ payerKey: "premera", sha256: "c".repeat(64), documents: [{ ...doc, role: "list" }] }).success).toBe(false);
  });
  it("has a hand-written rule for every payer the refresh reads", () => {
    expect(Object.keys(SOC_RULES).sort()).toEqual([...SOC_PAYER_KEYS].sort());
    for (const r of Object.values(SOC_RULES)) expect(r.writtenFrom.criteriaHash).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("quoteInText", () => {
  it("finds a quote across PDF line breaks, curly quotes and an ellipsis, and misses changed words", () => {
    const text = "Ongoing outpatient hospital facility-based\ninfusion duration of therapy will be no more\nthan 6 months to allow for reassessment of the individual\u2019s ability";
    expect(quoteInText("Ongoing outpatient hospital facility-based infusion … no more than 6 months to allow for reassessment of the individual's ability", text)).toBe(true);
    expect(quoteInText("no more than 3 months", text)).toBe(false);
  });
});
