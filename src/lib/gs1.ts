/**
 * Decode what a barcode scanner returns from a drug package: a GS1 DataMatrix element
 * string (DSCSA product identifier: GTIN, expiry, lot, serial), a linear UPC-A, or a
 * typed NDC. A US drug GTIN-14 is indicator digit + "03" + the 10-digit NDC + check
 * digit; the NDC's segment layout (4-4-2, 5-3-2, 5-4-1) is not in the barcode, so the
 * three 11-digit candidates are returned for lookup.
 */
import { parseNdc } from "./ndc";

export interface ScanParse {
  kind: "gs1" | "upc" | "ndc" | "unknown";
  gtin: string | null;
  /** 10 digits, no hyphens; layout unknown. */
  ndc10: string | null;
  /** 11-digit candidates to look up (one when the input was an unambiguous NDC). */
  candidates: string[];
  expiry: string | null;
  lot: string | null;
  serial: string | null;
  problems: string[];
}

const GS = "\u001d";

/** GS1 mod-10 check digit over every digit but the last. */
export function gtinCheckDigitValid(code: string): boolean {
  if (!/^\d{8,14}$/.test(code)) return false;
  const digits = code.split("").map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

export function ndc10Candidates(ndc10: string): string[] {
  if (!/^\d{10}$/.test(ndc10)) return [];
  return [`0${ndc10}`, `${ndc10.slice(0, 5)}0${ndc10.slice(5)}`, `${ndc10.slice(0, 9)}0${ndc10.slice(9)}`];
}

/** YYMMDD (DD may be 00 = end of month) → ISO date. */
function gs1Date(v: string): string | null {
  const m = v.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (!m) return null;
  const year = 2000 + Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const day = m[3] === "00" ? new Date(Date.UTC(year, month, 0)).getUTCDate() : Number(m[3]);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const FIXED: Record<string, number> = { "01": 14, "17": 6, "11": 6, "15": 6, "16": 6, "13": 6 };

function parseElementString(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Human-readable form: (01)00350242005121(17)271231(10)ABC123
  if (s.startsWith("(")) {
    for (const m of s.matchAll(/\((\d{2,4})\)([^(]*)/g)) out[m[1]] = m[2].trim();
    return out;
  }
  let i = 0;
  while (i < s.length) {
    if (s[i] === GS) {
      i++;
      continue;
    }
    const ai = s.slice(i, i + 2);
    i += 2;
    if (FIXED[ai]) {
      out[ai] = s.slice(i, i + FIXED[ai]);
      i += FIXED[ai];
    } else if (ai === "10" || ai === "21") {
      const end = s.indexOf(GS, i);
      out[ai] = s.slice(i, end < 0 ? s.length : end);
      i = end < 0 ? s.length : end + 1;
    } else break; // unknown AI: stop rather than guess
  }
  return out;
}

export function parseScan(input: string): ScanParse {
  const empty: ScanParse = { kind: "unknown", gtin: null, ndc10: null, candidates: [], expiry: null, lot: null, serial: null, problems: [] };
  let s = input.trim().replace(/<GS>|\{GS\}/gi, GS);
  s = s.replace(/^\][A-Za-z]\d/, ""); // symbology identifier such as ]d2 or ]C1
  s = s.replace(/^\u001d+/, ""); // leading FNC1, which decoders such as zxing return as GS
  if (!s) return { ...empty, problems: ["Nothing was scanned."] };

  // A typed or pasted NDC with hyphens.
  if (/^\d{4,5}-\d{3,4}-\d{1,2}$/.test(s)) {
    const p = parseNdc(s);
    return p.kind === "package" ? { ...empty, kind: "ndc", candidates: [p.ndc11] } : { ...empty, problems: [p.kind === "invalid" ? p.reason : "Not a package NDC."] };
  }
  // 11 digits: an NDC in claim format. 10 digits: an NDC without hyphens.
  if (/^\d{11}$/.test(s)) return { ...empty, kind: "ndc", candidates: [s] };
  if (/^\d{10}$/.test(s)) return { ...empty, kind: "ndc", ndc10: s, candidates: ndc10Candidates(s) };
  // UPC-A on drug labels: "3" + NDC10 + check digit.
  if (/^\d{12}$/.test(s)) {
    if (!s.startsWith("3")) return { ...empty, kind: "upc", gtin: s, problems: ["This UPC does not carry an NDC (drug UPCs start with 3)."] };
    const problems = gtinCheckDigitValid(s) ? [] : ["The UPC check digit does not match; rescan."];
    const ndc10 = s.slice(1, 11);
    return { ...empty, kind: "upc", gtin: s, ndc10, candidates: ndc10Candidates(ndc10), problems };
  }

  const ai = parseElementString(s.startsWith("01") || s.startsWith("(") ? s : `01${s}`);
  const gtin = ai["01"] && /^\d{14}$/.test(ai["01"]) ? ai["01"] : null;
  if (!gtin) return { ...empty, kind: "unknown", problems: ["No GS1 GTIN (AI 01) or NDC was found in the scan."] };
  const problems: string[] = [];
  if (!gtinCheckDigitValid(gtin)) problems.push("The GTIN check digit does not match; rescan.");
  const ndc10 = gtin.slice(1, 3) === "03" ? gtin.slice(3, 13) : null;
  if (!ndc10) problems.push("This GTIN does not embed a US NDC (it should start with an indicator digit and 03).");
  const expiry = ai["17"] ? gs1Date(ai["17"]) : null;
  return {
    kind: "gs1",
    gtin,
    ndc10,
    candidates: ndc10 ? ndc10Candidates(ndc10) : [],
    expiry,
    lot: ai["10"] ?? null,
    serial: ai["21"] ?? null,
    problems,
  };
}
