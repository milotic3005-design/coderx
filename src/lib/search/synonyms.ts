/**
 * Widely used clinical abbreviations → the generic name they stand for.
 *
 * Used ONLY to expand a search query (the result explains the expansion). These
 * never create or influence a code assignment.
 */
export const ABBREVIATIONS: Record<string, string> = {
  ivig: "immune globulin",
  scig: "immune globulin",
  "5fu": "fluorouracil",
  "5 fu": "fluorouracil",
  mtx: "methotrexate",
  epo: "epoetin",
  tpa: "alteplase",
  gcsf: "filgrastim",
  "g csf": "filgrastim",
  txa: "tranexamic acid",
  vanco: "vancomycin",
  b12: "cyanocobalamin",
  "vitamin b12": "cyanocobalamin",
  atg: "anti thymocyte globulin",
  ritux: "rituximab",
  pegfil: "pegfilgrastim",
  "zoledronic": "zoledronic acid",
  hcg: "chorionic gonadotropin",
  dhe: "dihydroergotamine",
  nac: "acetylcysteine",
};

export interface Expansion {
  from: string;
  to: string;
}

/** Variants of a normalized query produced by whole-query or per-token abbreviation expansion. */
export function expandQuery(normalized: string): Expansion[] {
  const out: Expansion[] = [];
  const whole = ABBREVIATIONS[normalized];
  if (whole) out.push({ from: normalized, to: whole });
  const tokens = normalized.split(" ");
  if (tokens.length > 1) {
    tokens.forEach((tok, i) => {
      const exp = ABBREVIATIONS[tok];
      if (exp) {
        const replaced = [...tokens.slice(0, i), exp, ...tokens.slice(i + 1)].join(" ");
        out.push({ from: tok, to: replaced });
      }
    });
  }
  return out.filter((e, i, arr) => arr.findIndex((x) => x.to === e.to) === i);
}
