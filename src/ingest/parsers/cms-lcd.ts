/**
 * Parser for the Medicare Coverage Database "Current LCD Data" export (CSV tables in
 * current_lcd_csv.zip). Keeps the HCPCS Level II drug codes of the DME MAC policies that
 * decide a Part B benefit: external infusion pumps, home IVIG, immunosuppressives, oral
 * antiemetics, and nebulizers.
 *
 * Not kept: LCD text, CPT rows, and equipment or supply codes. L33826 (oral anticancer) lists
 * only catch-all codes and L38953 (parenteral nutrition) lists no drug codes, so those two
 * are rules in src/lib/part-b-d.ts, not data.
 */
import { eachRow, MCD_DRUG_CODE_RE } from "./cms-mcd";

export const DME_POLICIES = { pump: 33794, ivig: 33610, immunosuppressive: 33824, antiemetic: 33827, nebulizer: 33370 } as const;
export type DmePolicy = keyof typeof DME_POLICIES;

/** contractor_type_lookup id for a DME MAC. */
const DME_MAC_TYPE = "10";

export const LCD_TABLES = ["lcd.csv", "lcd_x_hcpc_code.csv", "lcd_x_contractor.csv"] as const;
export type LcdTables = Record<(typeof LCD_TABLES)[number], string>;

export interface DmePolicyCode {
  policy: DmePolicy;
  lcdId: number;
  version: number;
  /** "L33794" */
  displayId: string;
  title: string;
  hcpcsCode: string;
  codeGroup: number | null;
}

export function parseLcdPolicies(tables: LcdTables): { rows: DmePolicyCode[]; excluded: { nonDrugCodes: number; proposed: number } } {
  const policyById = new Map(Object.entries(DME_POLICIES).map(([policy, id]) => [String(id), policy as DmePolicy]));
  const dmeLcds = new Set<string>();
  eachRow(tables["lcd_x_contractor.csv"], (r) => {
    if (r.contractor_type_id === DME_MAC_TYPE) dmeLcds.add(`${r.lcd_id}|${r.lcd_version}`);
  });

  const active = new Map<string, { policy: DmePolicy; title: string }>();
  let proposed = 0;
  eachRow(tables["lcd.csv"], (r) => {
    const key = `${r.lcd_id}|${r.lcd_version}`;
    if (!dmeLcds.has(key)) return;
    if (r.status !== "A") {
      proposed++;
      return;
    }
    const policy = policyById.get(r.lcd_id);
    if (policy) active.set(key, { policy, title: (r.title ?? "").replace(/\s+/g, " ").trim() });
  });

  const rows: DmePolicyCode[] = [];
  const seen = new Set<string>();
  let nonDrugCodes = 0;
  eachRow(tables["lcd_x_hcpc_code.csv"], (r) => {
    const lcd = active.get(`${r.lcd_id}|${r.lcd_version}`);
    if (!lcd) return;
    const hcpcsCode = (r.hcpc_code_id ?? "").trim().toUpperCase();
    if (!MCD_DRUG_CODE_RE.test(hcpcsCode)) {
      nonDrugCodes++;
      return;
    }
    const codeGroup = r.hcpc_code_group ? Number(r.hcpc_code_group) : null;
    const dedupe = `${lcd.policy}|${hcpcsCode}|${codeGroup}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    rows.push({ policy: lcd.policy, lcdId: Number(r.lcd_id), version: Number(r.lcd_version), displayId: `L${r.lcd_id}`, title: lcd.title, hcpcsCode, codeGroup });
  });
  return { rows, excluded: { nonDrugCodes, proposed } };
}
