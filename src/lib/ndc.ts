/**
 * National Drug Code (NDC) parsing and normalization.
 *
 * FDA assigns 10-digit NDCs in three segment layouts (4-4-2, 5-3-2, 5-4-1).
 * HIPAA transactions and CMS files use an 11-digit 5-4-2 form, created by adding a
 * leading zero to the short segment. Hyphenated input is unambiguous; an
 * unhyphenated 10-digit string is ambiguous and yields every possible candidate.
 */

export type PackageFormat = "4-4-2" | "5-3-2" | "5-4-1" | "5-4-2" | "11-digit";
export type ProductFormat = "4-4" | "5-3" | "5-4";

export interface NdcPackageParse {
  kind: "package";
  input: string;
  /** 11 digits, no separators. */
  ndc11: string;
  format: PackageFormat;
}

export interface NdcAmbiguousParse {
  kind: "ambiguous";
  input: string;
  candidates: { ndc11: string; format: "4-4-2" | "5-3-2" | "5-4-1" }[];
}

export interface NdcProductParse {
  kind: "product";
  input: string;
  /** Normalized 9-digit labeler+product codes (5-4). */
  candidates: { productNdc9: string; format: ProductFormat }[];
}

export interface NdcInvalidParse {
  kind: "invalid";
  input: string;
  reason: string;
}

export type NdcParse = NdcPackageParse | NdcAmbiguousParse | NdcProductParse | NdcInvalidParse;

const UNICODE_DASHES = /[‐-―−﹘﹣－]/g;

/** Collapse spaces/hyphens into single hyphens and strip a claim-style "N4" qualifier. */
function canonicalize(input: string): string {
  let s = input.trim().replace(UNICODE_DASHES, "-");
  s = s.replace(/^n4(?=\d)/i, "");
  s = s.replace(/[\s-]+/g, "-").replace(/^-+|-+$/g, "");
  return s;
}

export function parseNdc(input: string): NdcParse {
  const s = canonicalize(input);
  if (!s) return { kind: "invalid", input, reason: "Empty NDC." };

  if (/^\d+-\d+-\d+$/.test(s)) {
    const [a, b, c] = s.split("-");
    const shape = `${a.length}-${b.length}-${c.length}`;
    switch (shape) {
      case "4-4-2":
        return { kind: "package", input, ndc11: `0${a}${b}${c}`, format: "4-4-2" };
      case "5-3-2":
        return { kind: "package", input, ndc11: `${a}0${b}${c}`, format: "5-3-2" };
      case "5-4-1":
        return { kind: "package", input, ndc11: `${a}${b}0${c}`, format: "5-4-1" };
      case "5-4-2":
        return { kind: "package", input, ndc11: `${a}${b}${c}`, format: "5-4-2" };
      default:
        return {
          kind: "invalid",
          input,
          reason: `Segment lengths ${shape} are not a valid NDC layout (expected 4-4-2, 5-3-2, 5-4-1, or 5-4-2).`,
        };
    }
  }

  if (/^\d+-\d+$/.test(s)) {
    const [a, b] = s.split("-");
    const shape = `${a.length}-${b.length}`;
    if (shape === "4-4") return { kind: "product", input, candidates: [{ productNdc9: `0${a}${b}`, format: "4-4" }] };
    if (shape === "5-3") return { kind: "product", input, candidates: [{ productNdc9: `${a}0${b}`, format: "5-3" }] };
    if (shape === "5-4") return { kind: "product", input, candidates: [{ productNdc9: `${a}${b}`, format: "5-4" }] };
    return { kind: "invalid", input, reason: `Segment lengths ${shape} are not a valid product NDC layout.` };
  }

  if (/^\d+$/.test(s)) {
    if (s.length === 11) return { kind: "package", input, ndc11: s, format: "11-digit" };
    if (s.length === 10) {
      return {
        kind: "ambiguous",
        input,
        candidates: [
          { ndc11: `0${s}`, format: "4-4-2" },
          { ndc11: `${s.slice(0, 5)}0${s.slice(5)}`, format: "5-3-2" },
          { ndc11: `${s.slice(0, 9)}0${s.slice(9)}`, format: "5-4-1" },
        ],
      };
    }
    if (s.length === 9) return { kind: "product", input, candidates: [{ productNdc9: s, format: "5-4" }] };
    if (s.length === 8) {
      return {
        kind: "product",
        input,
        candidates: [
          { productNdc9: `0${s}`, format: "4-4" },
          { productNdc9: `${s.slice(0, 5)}0${s.slice(5)}`, format: "5-3" },
        ],
      };
    }
    return { kind: "invalid", input, reason: `An NDC has 10 or 11 digits; received ${s.length}.` };
  }

  return { kind: "invalid", input, reason: "NDCs contain only digits and optional hyphens." };
}

/** Normalize an unambiguous NDC (hyphenated 10-digit or any 11-digit form) to 11 digits, else null. */
export function toNdc11(input: string): string | null {
  const parsed = parseNdc(input);
  return parsed.kind === "package" ? parsed.ndc11 : null;
}

/** 11-digit → "12345-6789-01". */
export function formatNdc11(ndc11: string): string {
  if (!/^\d{11}$/.test(ndc11)) return ndc11;
  return `${ndc11.slice(0, 5)}-${ndc11.slice(5, 9)}-${ndc11.slice(9)}`;
}

/** 9-digit product code → "12345-6789". */
export function formatProductNdc9(productNdc9: string): string {
  if (!/^\d{9}$/.test(productNdc9)) return productNdc9;
  return `${productNdc9.slice(0, 5)}-${productNdc9.slice(5)}`;
}

/** Normalize an FDA product NDC ("0002-0152", "50242-060") to 9 digits, else null. */
export function toProductNdc9(productNdc: string): string | null {
  const parsed = parseNdc(productNdc);
  if (parsed.kind === "product" && parsed.candidates.length === 1) return parsed.candidates[0].productNdc9;
  return null;
}

/** Labeler code (first segment) of an 11-digit NDC. */
export function labelerOf(ndc11: string): string {
  return ndc11.slice(0, 5);
}

/** Heuristic used by search: does the query look like an NDC rather than a name? */
export function looksLikeNdc(query: string): boolean {
  const s = canonicalize(query);
  if (!/^[\d-]+$/.test(s)) return false;
  const digits = s.replace(/-/g, "").length;
  return digits >= 8 && digits <= 11;
}
