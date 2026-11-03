/**
 * Parser for the Medicare Coverage Database "Current Article Data" export (CSV tables in
 * current_article_csv.zip). Keeps active articles that list a HCPCS Level II drug code
 * (J, Q, C9, A9 families), with their contractors and the states their A/B MACs serve,
 * the drug codes, and the ICD-10-CM codes they cover with CMS's descriptions.
 *
 * Not kept: CPT rows (AMA copyright) and descriptions from the HCPCS table, article text
 * and group paragraphs (instructions may quote CPT), revenue and bill-type codes, and
 * every article without a drug code.
 */
import Papa from "papaparse";
import { isCptLike } from "@/lib/hcpcs";

export const MCD_DRUG_CODE_RE = /^(J\d{4}|Q\d{4}|C9\d{3}|A9\d{3})$/;
/** contractor_type_lookup ids for A/B MACs: MAC - Part B, A and B MAC, A and B and HHH MAC. */
const AB_MAC_TYPES = new Set(["9", "12", "13"]);
/** state_lookup splits some states into Medicare regions (e.g. DN "New York - Downstate"); report the state's USPS code. */
const REGION_STATE: Record<string, string> = { DN: "NY", QN: "NY", UN: "NY", NF: "CA", SF: "CA", EM: "MO", WM: "MO", CNMI: "MP" };

export interface McdContractor {
  id: string;
  number: string | null;
  name: string | null;
  type: string | null;
}

export interface McdArticle {
  articleId: number;
  version: number;
  /** "A56380" */
  displayId: string;
  title: string;
  articleType: string | null;
  effectiveDate: string | null;
  endDate: string | null;
  contractors: McdContractor[];
  /** USPS codes of the states the article's contractors serve. */
  states: string[];
}

export interface McdArticleCode {
  articleId: number;
  version: number;
  hcpcsCode: string;
  group: number | null;
}

export interface McdArticleIcd10 {
  articleId: number;
  version: number;
  code: string;
  group: number | null;
  description: string | null;
  /** CMS marks some codes with an asterisk (additional coding requirements in the article). */
  asterisk: boolean;
  sortOrder: number | null;
}

export interface McdParse {
  articles: McdArticle[];
  hcpcs: McdArticleCode[];
  icd10: McdArticleIcd10[];
  excluded: { cptRows: number; articlesWithoutDrugCodes: number; inactiveArticles: number };
}

export const MCD_TABLES = ["article.csv", "article_x_hcpc_code.csv", "article_x_icd10_covered.csv", "article_x_contractor.csv", "contractor.csv", "contractor_jurisdiction.csv", "state_lookup.csv", "contractor_type_lookup.csv"] as const;
export type McdTables = Record<(typeof MCD_TABLES)[number], string>;

/** Calls `row` for each CSV record as a header-keyed object, without holding the parsed table. */
function eachRow(text: string, row: (r: Record<string, string>) => void) {
  Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true, step: (res) => row(res.data) });
}

const int = (v: string | undefined) => {
  const n = Number((v ?? "").trim());
  return v && Number.isFinite(n) ? n : null;
};
const date = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

export function parseMcdArticles(tables: McdTables): McdParse {
  // Contractors, their type names, and the states they serve (active jurisdictions only).
  const typeNames = new Map<string, string>();
  eachRow(tables["contractor_type_lookup.csv"], (r) => typeNames.set(r.contractor_type_id, r.description));
  const stateAbbrev = new Map<string, string>();
  eachRow(tables["state_lookup.csv"], (r) => stateAbbrev.set(r.state_id, REGION_STATE[r.state_abbrev] ?? r.state_abbrev));
  const contractors = new Map<string, McdContractor>();
  eachRow(tables["contractor.csv"], (r) =>
    contractors.set(`${r.contractor_id}|${r.contractor_type_id}|${r.contractor_version}`, { id: r.contractor_id, number: r.contractor_number || null, name: r.contractor_bus_name || null, type: typeNames.get(r.contractor_type_id) ?? null }),
  );
  // States come from A/B MAC jurisdictions only (Part B, A and B, A and B and HHH): a Part A-only
  // or home health contractor listed for a state does not make an article that state's policy.
  const contractorStates = new Map<string, Set<string>>();
  eachRow(tables["contractor_jurisdiction.csv"], (r) => {
    if (!AB_MAC_TYPES.has(r.contractor_type_id)) return;
    if (r.term_date && r.term_date.slice(0, 10) < new Date().toISOString().slice(0, 10)) return;
    const k = `${r.contractor_id}|${r.contractor_type_id}|${r.contractor_version}`;
    const s = stateAbbrev.get(r.state_id);
    if (s) contractorStates.set(k, (contractorStates.get(k) ?? new Set()).add(s));
  });

  // Drug codes per article; CPT rows are counted and dropped.
  const hcpcs: McdArticleCode[] = [];
  const drugArticles = new Set<string>();
  let cptRows = 0;
  eachRow(tables["article_x_hcpc_code.csv"], (r) => {
    const code = (r.hcpc_code_id ?? "").trim().toUpperCase();
    if (isCptLike(code)) {
      cptRows++;
      return;
    }
    if (!MCD_DRUG_CODE_RE.test(code)) return;
    const articleId = int(r.article_id);
    const version = int(r.article_version);
    if (articleId == null || version == null) return;
    hcpcs.push({ articleId, version, hcpcsCode: code, group: int(r.hcpc_code_group) });
    drugArticles.add(`${articleId}|${version}`);
  });

  const articleContractors = new Map<string, McdContractor[]>();
  const articleStates = new Map<string, Set<string>>();
  eachRow(tables["article_x_contractor.csv"], (r) => {
    const a = `${r.article_id}|${r.article_version}`;
    if (!drugArticles.has(a)) return;
    const k = `${r.contractor_id}|${r.contractor_type_id}|${r.contractor_version}`;
    const c = contractors.get(k);
    if (c) articleContractors.set(a, [...(articleContractors.get(a) ?? []), c]);
    for (const s of contractorStates.get(k) ?? []) articleStates.set(a, (articleStates.get(a) ?? new Set()).add(s));
  });

  const articles: McdArticle[] = [];
  const active = new Set<string>();
  let articlesWithoutDrugCodes = 0;
  let inactiveArticles = 0;
  eachRow(tables["article.csv"], (r) => {
    const a = `${r.article_id}|${r.article_version}`;
    if (!drugArticles.has(a)) {
      articlesWithoutDrugCodes++;
      return;
    }
    if (r.status !== "A") {
      inactiveArticles++;
      return;
    }
    active.add(a);
    articles.push({
      articleId: Number(r.article_id),
      version: Number(r.article_version),
      displayId: `A${r.article_id}`,
      title: (r.title ?? "").replace(/\s+/g, " ").trim(),
      articleType: r.article_type || null,
      effectiveDate: date(r.article_eff_date),
      endDate: date(r.article_end_date),
      contractors: articleContractors.get(a) ?? [],
      states: [...(articleStates.get(a) ?? [])].sort(),
    });
  });

  const icd10: McdArticleIcd10[] = [];
  eachRow(tables["article_x_icd10_covered.csv"], (r) => {
    if (!active.has(`${r.article_id}|${r.article_version}`)) return;
    const code = (r.icd10_code_id ?? "").trim().toUpperCase();
    if (!code) return;
    icd10.push({
      articleId: Number(r.article_id),
      version: Number(r.article_version),
      code,
      group: int(r.icd10_covered_group),
      description: (r.description ?? "").trim() || null,
      asterisk: r.asterisk === "Y",
      sortOrder: int(r.sort_order),
    });
  });

  return {
    articles,
    hcpcs: hcpcs.filter((h) => active.has(`${h.articleId}|${h.version}`)),
    icd10,
    excluded: { cptRows, articlesWithoutDrugCodes, inactiveArticles },
  };
}

/** The CMS page for an article version. */
export function mcdArticleUrl(articleId: number, version?: number): string {
  return `https://www.cms.gov/medicare-coverage-database/view/article.aspx?articleid=${articleId}${version ? `&ver=${version}` : ""}`;
}
