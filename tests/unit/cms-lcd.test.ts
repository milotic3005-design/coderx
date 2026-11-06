import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LCD_TABLES, parseLcdPolicies, type LcdTables } from "@/ingest/parsers/cms-lcd";
import { FIXTURE_DIR } from "../helpers/fixtures";

// Excerpts of CMS's Medicare Coverage Database "Current LCD Data" export.
const tables = Object.fromEntries(LCD_TABLES.map((n) => [n, readFileSync(join(FIXTURE_DIR, "mcd-lcds", n), "utf8")])) as LcdTables;

describe("DME LCD policy code lists", () => {
  const p = parseLcdPolicies(tables);

  it("files a code under every policy that lists it", () => {
    expect(p.rows.filter((r) => r.hcpcsCode === "J1569").map((r) => r.policy).sort()).toEqual(["ivig", "pump"]);
  });
  it("keeps drug codes and drops equipment", () => {
    expect(p.rows.some((r) => r.hcpcsCode === "E0776")).toBe(false);
    expect(p.excluded.nonDrugCodes).toBeGreaterThan(0);
  });
  it("ignores proposed LCDs", () => {
    expect(p.rows.some((r) => r.lcdId === 40247)).toBe(false);
    expect(p.excluded.proposed).toBeGreaterThan(0);
  });
  it("ignores LCDs outside the five policies", () => {
    expect(new Set(p.rows.map((r) => r.lcdId))).toEqual(new Set([33794, 33610, 33824, 33827, 33370]));
  });
  it("records the LCD's number, title, and group", () => {
    expect(p.rows.find((r) => r.hcpcsCode === "J3285")).toMatchObject({ policy: "pump", displayId: "L33794", title: "External Infusion Pumps", version: 176 });
  });
  it("needs a DME MAC contractor", () => {
    const noDme = { ...tables, "lcd_x_contractor.csv": tables["lcd_x_contractor.csv"].replaceAll(",10,", ",12,") };
    expect(parseLcdPolicies(noDme).rows).toEqual([]);
  });
});
