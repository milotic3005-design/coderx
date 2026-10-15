/**
 * Parsers for FDA NDC Directory text files (product.txt / package.txt and the
 * "excluded" variants, which share the layout) and the FDA Purple Book CSV.
 */
import { parseNdc, toProductNdc9 } from "@/lib/ndc";
import { cell, columnFinder, findHeaderRow, parseCsvRows } from "../csv";
import { splitLines } from "../text-decode";
import { parseLongDate, parseYmd } from "../values";
import type { Rejected } from "./hcpcs";

export interface FdaProduct {
  productId: string;
  productNdc: string;
  productNdc9: string | null;
  productType: string | null;
  proprietaryName: string | null;
  proprietaryNameSuffix: string | null;
  nonproprietaryName: string | null;
  dosageForm: string | null;
  routes: string[];
  marketingStart: string | null;
  marketingEnd: string | null;
  marketingCategory: string | null;
  applicationNumber: string | null;
  labelerName: string | null;
  substances: string[];
  strengths: string[];
  strengthUnits: string[];
  pharmClasses: string[];
  deaSchedule: string | null;
  excludeFlag: string | null;
  listingCertifiedThrough: string | null;
}

export interface FdaPackage {
  productId: string;
  productNdc: string;
  packageNdc: string;
  ndc11: string;
  description: string | null;
  marketingStart: string | null;
  marketingEnd: string | null;
  excludeFlag: string | null;
  sample: boolean;
}

function splitList(value: string, sep = ";"): string[] {
  return value
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** "Name [EPC], Other Name [MoA]" → ["Name [EPC]", "Other Name [MoA]"]. */
export function splitPharmClasses(value: string): string[] {
  return (value.match(/[^,]+?\[[A-Za-z /]+\]/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

function* tsvRecords(text: string): Generator<{ line: number; get: (name: string) => string }> {
  const lines = splitLines(text);
  if (lines.length === 0) return;
  const header = lines[0].split("\t").map((h) => h.trim().toUpperCase());
  const index = new Map(header.map((h, i) => [h, i]));
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = line.split("\t");
    yield { line: i + 1, get: (name: string) => (cols[index.get(name) ?? -1] ?? "").trim() };
  }
}

export function parseFdaProducts(
  text: string,
  keep: (p: FdaProduct) => boolean = () => true,
): { products: FdaProduct[]; total: number; rejected: Rejected[] } {
  const products: FdaProduct[] = [];
  const rejected: Rejected[] = [];
  let total = 0;
  for (const r of tsvRecords(text)) {
    total++;
    const productId = r.get("PRODUCTID");
    const productNdc = r.get("PRODUCTNDC");
    if (!productId || !productNdc) {
      rejected.push({ line: r.line, reason: "Missing PRODUCTID or PRODUCTNDC", sample: productId || productNdc });
      continue;
    }
    const numerators = splitList(r.get("ACTIVE_NUMERATOR_STRENGTH"));
    const units = splitList(r.get("ACTIVE_INGRED_UNIT"));
    const product: FdaProduct = {
      productId,
      productNdc,
      productNdc9: toProductNdc9(productNdc),
      productType: r.get("PRODUCTTYPENAME") || null,
      proprietaryName: r.get("PROPRIETARYNAME") || null,
      proprietaryNameSuffix: r.get("PROPRIETARYNAMESUFFIX") || null,
      nonproprietaryName: r.get("NONPROPRIETARYNAME") || null,
      dosageForm: r.get("DOSAGEFORMNAME") || null,
      routes: splitList(r.get("ROUTENAME")),
      marketingStart: parseYmd(r.get("STARTMARKETINGDATE")),
      marketingEnd: parseYmd(r.get("ENDMARKETINGDATE")),
      marketingCategory: r.get("MARKETINGCATEGORYNAME") || null,
      applicationNumber: r.get("APPLICATIONNUMBER") || null,
      labelerName: r.get("LABELERNAME") || null,
      substances: splitList(r.get("SUBSTANCENAME")),
      strengths: numerators.map((n, i) => (units[i] ? `${n} ${units[i]}` : n)),
      strengthUnits: units,
      pharmClasses: splitPharmClasses(r.get("PHARM_CLASSES")),
      deaSchedule: r.get("DEASCHEDULE") || null,
      excludeFlag: ["E", "U", "I", "D"].includes(r.get("NDC_EXCLUDE_FLAG")) ? r.get("NDC_EXCLUDE_FLAG") : null,
      listingCertifiedThrough: parseYmd(r.get("LISTING_RECORD_CERTIFIED_THROUGH")),
    };
    if (keep(product)) products.push(product);
  }
  return { products, total, rejected };
}

export function parseFdaPackages(
  text: string,
  keep: (p: FdaPackage) => boolean = () => true,
): { packages: FdaPackage[]; total: number; rejected: Rejected[] } {
  const packages: FdaPackage[] = [];
  const rejected: Rejected[] = [];
  let total = 0;
  for (const r of tsvRecords(text)) {
    total++;
    const packageNdc = r.get("NDCPACKAGECODE");
    const parsed = parseNdc(packageNdc);
    if (parsed.kind !== "package") {
      rejected.push({ line: r.line, reason: `Unparseable package NDC '${packageNdc}'`, sample: packageNdc });
      continue;
    }
    const pkg: FdaPackage = {
      productId: r.get("PRODUCTID"),
      productNdc: r.get("PRODUCTNDC"),
      packageNdc,
      ndc11: parsed.ndc11,
      description: r.get("PACKAGEDESCRIPTION").replace(/\s+/g, " ") || null,
      marketingStart: parseYmd(r.get("STARTMARKETINGDATE")),
      marketingEnd: parseYmd(r.get("ENDMARKETINGDATE")),
      excludeFlag: ["E", "U", "I", "D"].includes(r.get("NDC_EXCLUDE_FLAG")) ? r.get("NDC_EXCLUDE_FLAG") : null,
      sample: r.get("SAMPLE_PACKAGE").toUpperCase() === "Y",
    };
    if (keep(pkg)) packages.push(pkg);
  }
  return { packages, total, rejected };
}

export interface PurpleBookRow {
  blaNumber: string;
  applicant: string | null;
  proprietaryName: string | null;
  properName: string | null;
  licenseType: string | null;
  strength: string | null;
  dosageForm: string | null;
  route: string | null;
  presentation: string | null;
  marketingStatus: string | null;
  licensure: string | null;
  approvalDate: string | null;
  interchangeableApprovalDate: string | null;
  refProperName: string | null;
  refProprietaryName: string | null;
  productNumber: string | null;
  center: string | null;
}

/** The monthly file has a "changes this month" section followed by the full list; parse the full list. */
export function parsePurpleBookCsv(text: string): { rows: PurpleBookRow[]; reportTitle: string | null } {
  const rows = parseCsvRows(text);
  const headerRows = rows.map((r, i) => ((r[0] ?? "").trim() === "N/R/U" ? i : -1)).filter((i) => i >= 0);
  const headerIdx = headerRows.length ? headerRows[headerRows.length - 1] : findHeaderRow(rows, (k) => k.includes("bla number"));
  if (headerIdx < 0) throw new Error("Purple Book: header row not found.");
  const col = columnFinder(rows[headerIdx]);
  const c = {
    bla: col("bla number"),
    applicant: col("applicant"),
    prop: col("proprietary name"),
    proper: col("proper name"),
    type: col("license type", "bla type"),
    strength: col("strength"),
    form: col("dosage form"),
    route: col("route of administration"),
    presentation: col("product presentation"),
    status: col("marketing status"),
    licensure: col("licensure"),
    approval: col("approval date"),
    interApproval: col("inter. approval date"),
    refProper: col("ref. product proper name"),
    refProp: col("ref. product proprietary name"),
    productNumber: col("product number"),
    center: col("center"),
  };
  const out: PurpleBookRow[] = [];
  for (const row of rows.slice(headerIdx + 1)) {
    const bla = cell(row, c.bla).replace(/\D/g, "");
    if (!bla) continue;
    const prop = cell(row, c.prop);
    out.push({
      blaNumber: bla,
      applicant: cell(row, c.applicant) || null,
      proprietaryName: prop && prop.toUpperCase() !== "N/A" ? prop : null,
      properName: cell(row, c.proper) || null,
      licenseType: cell(row, c.type) || null,
      strength: cell(row, c.strength) || null,
      dosageForm: cell(row, c.form) || null,
      route: cell(row, c.route) || null,
      presentation: cell(row, c.presentation) || null,
      marketingStatus: cell(row, c.status) || null,
      licensure: cell(row, c.licensure) || null,
      approvalDate: parseLongDate(cell(row, c.approval)),
      interchangeableApprovalDate: parseLongDate(cell(row, c.interApproval)),
      refProperName: cell(row, c.refProper) || null,
      refProprietaryName: cell(row, c.refProp) || null,
      productNumber: cell(row, c.productNumber) || null,
      center: cell(row, c.center) || null,
    });
  }
  return { rows: out, reportTitle: (rows[0]?.[0] ?? "").trim() || null };
}
