import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { clinicalFor, dailyMedSearchUrl, draftFileSchema, ICD10CM_RE, referenceFileSchema, type ClinicalEntry, type DraftEntry } from "@/lib/clinical";
import { fromReviewCsv, mergeReviewed, normalizeReviewDate, parseIcd10CodeFile, parseIcd10List, REVIEW_COLUMNS, toReviewCsv, unknownIcd10 } from "@/lib/clinical-review";

const DATA = path.resolve(__dirname, "../../data");
const draftFiles = readdirSync(path.join(DATA, "clinical-drafts")).filter((f) => f.endsWith(".json"));

const draft: DraftEntry = {
  id: "ceftriaxone",
  drug: "Ceftriaxone",
  hcpcs: ["J0696"],
  indications: [
    { condition: "Lower respiratory tract infections", icd10: [{ code: "J18.9", description: "Pneumonia, unspecified organism" }], dose: "1–2 g IV once daily" },
    { condition: "Uncomplicated gonorrhea", icd10: [{ code: "A54.00" }], dose: "250 mg IM single dose" },
  ],
  evidence: [{ label: "FDA prescribing information on DailyMed (NLM): Ceftriaxone", url: dailyMedSearchUrl("ceftriaxone") }],
  notes: "DRAFT note that is never published.",
};

/** Export the drafts, then fill in review columns per row (by 0-based data row). */
function reviewed(drafts: DraftEntry[], edits: Record<number, Partial<Record<keyof typeof REVIEW_COLUMNS, string>>>): string {
  const rows = Papa.parse<string[]>(toReviewCsv(drafts).replace(/^﻿/, "")).data;
  const header = rows[0];
  for (const [i, change] of Object.entries(edits)) {
    for (const [key, value] of Object.entries(change)) rows[Number(i) + 1][header.indexOf(REVIEW_COLUMNS[key as keyof typeof REVIEW_COLUMNS])] = value!;
  }
  return "﻿" + Papa.unparse(rows);
}

const approve = { decision: "APPROVE", reviewer: "Pat Lee, PharmD", reviewedOn: "2026-11-02" };

describe("clinical reference files", () => {
  it("every draft file validates, with unique entry IDs and only ICD-10-CM-shaped codes", () => {
    expect(draftFiles.length).toBeGreaterThan(0);
    const ids: string[] = [];
    for (const f of draftFiles) {
      const parsed = draftFileSchema.parse(JSON.parse(readFileSync(path.join(DATA, "clinical-drafts", f), "utf8")));
      ids.push(...parsed.entries.map((e) => e.id));
      for (const e of parsed.entries) for (const ind of e.indications) for (const c of ind.icd10) expect(c.code).toMatch(ICD10CM_RE);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("the reviewed file validates (every entry has a reviewer and a date)", () => {
    expect(() => referenceFileSchema.parse(JSON.parse(readFileSync(path.join(DATA, "clinical-reference.json"), "utf8")))).not.toThrow();
  });

  it("drafts are never accepted as reviewed entries", () => {
    expect(referenceFileSchema.safeParse({ entries: [draft] }).success).toBe(false);
  });

  it("clinicalFor returns reviewed entries that share any of the drug's codes", () => {
    const entry: ClinicalEntry = { ...draft, reviewer: "Pat Lee, PharmD", reviewedAt: "2026-11-02" };
    expect(clinicalFor(["J0696", "J3490"], [entry])).toEqual([entry]);
    expect(clinicalFor(["J0690"], [entry])).toEqual([]);
  });
});

describe("review CSV round trip", () => {
  it("exports one row per indication with a BOM and empty review columns", () => {
    const csv = toReviewCsv([draft]);
    expect(csv.startsWith("﻿")).toBe(true);
    const rows = Papa.parse<string[]>(csv.slice(1)).data;
    expect(rows).toHaveLength(3);
    expect(rows[1].slice(0, 6)).toEqual(["ceftriaxone", "Ceftriaxone", "J0696", "Lower respiratory tract infections", "J18.9 — Pneumonia, unspecified organism", "1–2 g IV once daily"]);
    expect(rows[2][4]).toBe("A54.00");
  });

  it("imports approved rows with the reviewer's edits, Excel's US date, and the draft's evidence label", () => {
    const csv = reviewed([draft], {
      0: { ...approve, reviewedOn: "11/2/2026", dose: "1–2 g IV once daily (max 4 g/day)", icd10: "J18.9 - Pneumonia, unspecified organism\nj15.9 Unspecified bacterial pneumonia", comment: "Check renal dosing." },
      1: { decision: "reject" },
    });
    const r = fromReviewCsv(csv, [draft], "2026-11-03");
    expect(r.errors).toEqual([]);
    expect([r.approved, r.rejected, r.skipped]).toEqual([1, 1, 0]);
    expect(r.entries).toEqual([
      {
        id: "ceftriaxone",
        drug: "Ceftriaxone",
        hcpcs: ["J0696"],
        indications: [
          {
            condition: "Lower respiratory tract infections",
            icd10: [
              { code: "J18.9", description: "Pneumonia, unspecified organism" },
              { code: "J15.9", description: "Unspecified bacterial pneumonia" },
            ],
            dose: "1–2 g IV once daily (max 4 g/day)",
          },
        ],
        evidence: draft.evidence,
        notes: "Check renal dosing.",
        reviewer: "Pat Lee, PharmD",
        reviewedAt: "2026-11-02",
      },
    ]);
  });

  it("leaves unreviewed rows out and imports nothing for an entry with no approved rows", () => {
    const r = fromReviewCsv(reviewed([draft], {}), [draft], "2026-11-03");
    expect(r).toMatchObject({ entries: [], approved: 0, skipped: 2, errors: [] });
  });

  it.each([
    [{ ...approve, reviewer: "" }, "need the reviewer's name"],
    [{ ...approve, reviewedOn: "next week" }, "is not a date"],
    [{ ...approve, reviewedOn: "2026-02-30" }, "is not a date"],
    [{ ...approve, reviewedOn: "2026-12-01" }, "is in the future"],
    [{ ...approve, icd10: "Pneumonia" }, "does not start with an ICD-10-CM code"],
    [{ ...approve, hcpcs: "J0696, 99213" }, "is not a HCPCS Level II code"],
    [{ ...approve, evidence: "dailymed.nlm.nih.gov" }, "https URL"],
    [{ ...approve, id: "made-up" }, "is not in any draft file"],
    [{ ...approve, decision: "OK" }, "must be APPROVE, REJECT, or blank"],
  ])("rejects an invalid approved row (%o)", (row, message) => {
    const r = fromReviewCsv(reviewed([draft], { 0: row }), [draft], "2026-11-03");
    expect(r.errors.join(" ")).toContain(message);
    expect(r.errors[0]).toMatch(/^Row 2:/);
  });

  it("requires one HCPCS list per entry", () => {
    const r = fromReviewCsv(reviewed([draft], { 0: approve, 1: { ...approve, hcpcs: "J0696, J0697" } }), [draft], "2026-11-03");
    expect(r.errors).toEqual(["Row 3: HCPCS codes differ from an earlier row of “ceftriaxone”; one entry has one code list."]);
  });

  it("names missing columns instead of guessing", () => {
    const r = fromReviewCsv("Entry ID,Drug\nceftriaxone,Ceftriaxone\n", [draft], "2026-11-03");
    expect(r.errors[0]).toMatch(/^Missing column\(s\): “HCPCS codes”/);
  });

  it("merges by entry ID, replacing an earlier review", () => {
    const a: ClinicalEntry = { ...draft, id: "a", reviewer: "Pat Lee, PharmD", reviewedAt: "2026-01-01" };
    const b: ClinicalEntry = { ...a, id: "b" };
    const a2: ClinicalEntry = { ...a, reviewedAt: "2026-11-02" };
    expect(mergeReviewed([b, a], [a2])).toEqual([a2, b]);
  });
});

describe("ICD-10-CM helpers", () => {
  it("parses code lists separated by semicolons or line breaks", () => {
    expect(parseIcd10List("A41.01 — Sepsis due to MSSA; t84.50xa–Infection of joint prosthesis\nN10")).toEqual([
      { code: "A41.01", description: "Sepsis due to MSSA" },
      { code: "T84.50XA", description: "Infection of joint prosthesis" },
      { code: "N10" },
    ]);
  });

  it("normalizes review dates", () => {
    expect(normalizeReviewDate("2026-11-03")).toBe("2026-11-03");
    expect(normalizeReviewDate("11/3/2026")).toBe("2026-11-03");
    expect(normalizeReviewDate("13/3/2026")).toBeNull();
  });

  it("reads billable codes from the CMS codes file and order file", () => {
    const codes = parseIcd10CodeFile("A419    Sepsis, unspecified organism\nN10     Acute pyelonephritis\n");
    expect([...codes]).toEqual(["A419", "N10"]);
    const order = parseIcd10CodeFile("00001 A00     0 Cholera                       Cholera\n00002 A000    1 Cholera due to V. cholerae    Cholera due to Vibrio cholerae 01, biovar cholerae\n");
    expect([...order]).toEqual(["A000"]);
    expect(unknownIcd10([{ id: "x", indications: [{ icd10: [{ code: "A41.9" }, { code: "A00" }] }] }], new Set(["A419", "A000"]))).toEqual(["x: A00"]);
  });
});
