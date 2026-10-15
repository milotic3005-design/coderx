/**
 * Parser for the CMS HCPCS Level II "alpha-numeric" fixed-width file
 * (HCPC####_MMM_ANWEB*.txt). Byte positions follow the CMS record layout
 * (HCPC####_recordlayout.txt): 320-byte records; RIC 3 = first line of a
 * procedure, RIC 4 = continuation of its long description, RIC 7/8 = modifiers.
 */
import { HCPCS_LEVEL2_RE, isCdtLike } from "@/lib/hcpcs";
import { splitLines } from "../text-decode";
import { parseYmd } from "../values";

export interface HcpcsRecord {
  code: string;
  sequence: string;
  longDescription: string;
  shortDescription: string | null;
  pricingIndicators: string[];
  multiplePricingIndicator: string | null;
  coverageCode: string | null;
  betos: string | null;
  typeOfService: string[];
  crossReferences: string[];
  processingNote: string | null;
  addedDate: string | null;
  actionEffectiveDate: string | null;
  terminationDate: string | null;
  actionCode: string | null;
}

export interface Rejected {
  line: number;
  reason: string;
  sample: string;
}

export interface HcpcsParseResult {
  records: HcpcsRecord[];
  modifierLines: number;
  excludedCdt: number;
  rejected: Rejected[];
}

/** 1-based inclusive positions from the record layout. */
function field(line: string, start: number, end: number): string {
  return line.slice(start - 1, end).trim();
}

function repeated(line: string, start: number, width: number, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const v = field(line, start + i * width, start + (i + 1) * width - 1);
    if (v) out.push(v);
  }
  return out;
}

export function parseHcpcsFixedWidth(text: string): HcpcsParseResult {
  const records: HcpcsRecord[] = [];
  const rejected: Rejected[] = [];
  let modifierLines = 0;
  let excludedCdt = 0;
  let current: HcpcsRecord | null = null;
  const seen = new Set<string>();

  splitLines(text).forEach((line, idx) => {
    if (!line.trim()) return;
    const lineNo = idx + 1;
    if (line.length < 11) {
      rejected.push({ line: lineNo, reason: "Line shorter than the record identification field", sample: line.slice(0, 40) });
      return;
    }
    const ric = line.charAt(10);
    if (ric === "7" || ric === "8") {
      modifierLines++;
      return;
    }
    const code = field(line, 1, 5).toUpperCase();
    if (ric === "4") {
      if (current && current.code === code) {
        const more = field(line, 12, 91);
        if (more) current.longDescription = `${current.longDescription} ${more}`.replace(/\s+/g, " ").trim();
      } else {
        rejected.push({ line: lineNo, reason: "Continuation line without a matching first line", sample: line.slice(0, 40) });
      }
      return;
    }
    if (ric !== "3") {
      rejected.push({ line: lineNo, reason: `Unknown record identification code '${ric}'`, sample: line.slice(0, 40) });
      return;
    }
    if (isCdtLike(code)) {
      excludedCdt++;
      current = null;
      return;
    }
    if (!HCPCS_LEVEL2_RE.test(code)) {
      rejected.push({ line: lineNo, reason: `Not a HCPCS Level II code: '${code}'`, sample: line.slice(0, 40) });
      current = null;
      return;
    }
    if (seen.has(code)) {
      rejected.push({ line: lineNo, reason: `Duplicate first line for ${code}`, sample: line.slice(0, 40) });
      current = null;
      return;
    }
    seen.add(code);
    const longDescription = field(line, 12, 91);
    if (!longDescription) {
      rejected.push({ line: lineNo, reason: `Missing long description for ${code}`, sample: line.slice(0, 40) });
      current = null;
      return;
    }
    current = {
      code,
      sequence: field(line, 6, 10),
      longDescription,
      shortDescription: field(line, 92, 119) || null,
      pricingIndicators: repeated(line, 120, 2, 4),
      multiplePricingIndicator: field(line, 128, 128) || null,
      crossReferences: repeated(line, 205, 5, 5),
      coverageCode: field(line, 230, 230) || null,
      processingNote: field(line, 253, 256) || null,
      betos: field(line, 257, 259) || null,
      typeOfService: repeated(line, 261, 1, 5),
      addedDate: parseYmd(field(line, 269, 276)),
      actionEffectiveDate: parseYmd(field(line, 277, 284)),
      terminationDate: parseYmd(field(line, 285, 292)),
      actionCode: field(line, 293, 293) || null,
    };
    records.push(current);
  });

  return { records, modifierLines, excludedCdt, rejected };
}

/** Rows of the CMS "NOC codes" spreadsheet → set of NOC/NOS codes. */
export function parseNocCodeRows(rows: string[][]): { codes: Set<string>; terminated: Map<string, string> } {
  const codes = new Set<string>();
  const terminated = new Map<string, string>();
  const header = rows.findIndex((r) => (r[0] ?? "").trim().toUpperCase() === "HCPCS");
  if (header < 0) throw new Error("NOC code list: header row 'HCPCS' not found.");
  for (const row of rows.slice(header + 1)) {
    const code = (row[0] ?? "").trim().toUpperCase();
    if (!HCPCS_LEVEL2_RE.test(code)) continue;
    codes.add(code);
    const term = parseYmd((row[3] ?? "").trim());
    if (term) terminated.set(code, term);
  }
  return { codes, terminated };
}
