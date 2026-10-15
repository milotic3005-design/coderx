/** Classify and normalize a raw search query. Pure — no I/O. */
import { isCptLike, normalizeHcpcs, normalizeHcpcsPrefix } from "@/lib/hcpcs";
import { looksLikeNdc, parseNdc, type NdcParse } from "@/lib/ndc";
import { normalizeText, STOPWORDS } from "@/lib/text";
import { expandQuery, type Expansion } from "./synonyms";

export const MAX_QUERY_LENGTH = 100;

export type QueryType =
  | "empty"
  | "hcpcs_code"
  | "hcpcs_prefix"
  | "ndc"
  | "ndc_ambiguous"
  | "product_ndc"
  | "invalid_ndc"
  | "labeler_code"
  | "cpt_like"
  | "text";

export interface ParsedQuery {
  raw: string;
  /** Trimmed and length-capped original. */
  display: string;
  normalized: string;
  /** Normalized tokens excluding stopwords. */
  tokens: string[];
  type: QueryType;
  hcpcsCode?: string;
  hcpcsPrefix?: string;
  ndc?: NdcParse;
  ndc11Candidates: string[];
  productNdc9Candidates: string[];
  labelerCode?: string;
  expansions: Expansion[];
  truncated: boolean;
}

export function parseQuery(raw: string): ParsedQuery {
  const collapsed = (raw ?? "").replace(/\s+/g, " ").trim();
  const truncated = collapsed.length > MAX_QUERY_LENGTH;
  const display = collapsed.slice(0, MAX_QUERY_LENGTH);
  const normalized = normalizeText(display);
  const tokens = normalized.split(" ").filter((t) => t && !STOPWORDS.has(t));
  const base: ParsedQuery = {
    raw,
    display,
    normalized,
    tokens,
    type: "text",
    ndc11Candidates: [],
    productNdc9Candidates: [],
    expansions: [],
    truncated,
  };

  if (!normalized) return { ...base, type: "empty" };

  const code = normalizeHcpcs(display);
  if (code) return { ...base, type: "hcpcs_code", hcpcsCode: code };

  if (/^\d{5}$/.test(display)) {
    return { ...base, type: "labeler_code", labelerCode: display };
  }

  if (looksLikeNdc(display)) {
    const ndc = parseNdc(display);
    switch (ndc.kind) {
      case "package":
        return { ...base, type: "ndc", ndc, ndc11Candidates: [ndc.ndc11] };
      case "ambiguous":
        return { ...base, type: "ndc_ambiguous", ndc, ndc11Candidates: ndc.candidates.map((c) => c.ndc11) };
      case "product":
        return { ...base, type: "product_ndc", ndc, productNdc9Candidates: ndc.candidates.map((c) => c.productNdc9) };
      case "invalid":
        return { ...base, type: "invalid_ndc", ndc };
    }
  }

  if (isCptLike(display)) return { ...base, type: "cpt_like" };

  const prefix = normalizeHcpcsPrefix(display);
  if (prefix) return { ...base, type: "hcpcs_prefix", hcpcsPrefix: prefix };

  return { ...base, type: "text", expansions: expandQuery(normalized) };
}

export const QUERY_TYPE_LABELS: Record<QueryType, string> = {
  empty: "Empty query",
  hcpcs_code: "HCPCS code",
  hcpcs_prefix: "HCPCS code prefix",
  ndc: "NDC (package)",
  ndc_ambiguous: "10-digit NDC without hyphens (ambiguous layout)",
  product_ndc: "Product NDC (labeler + product)",
  invalid_ndc: "Number that is not a valid NDC layout",
  labeler_code: "FDA labeler code or CPT-style number",
  cpt_like: "CPT-style code",
  text: "Name or keyword",
};
