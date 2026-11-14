/**
 * Reads the UMP Preferred Drug List PDF. Only its "Alphabetical Index" pages are used:
 * a four-column table (Drug Name, Special Code, Tier, Category) with one row per drug.
 * A PDF has no rows or cells, only words placed at x/y positions, so rows are rebuilt
 * from positions. Each row has exactly one Special Code cell ("-" when there is none),
 * so that cell anchors the row; names and tiers that wrap onto lower lines join the row above.
 */

/** One word or phrase on a page, at its position in PDF points (y grows upward). */
export interface PdfText {
  str: string;
  x: number;
  y: number;
}

export interface UmpEntry {
  name: string;
  tier: string;
  /** Special codes such as PA, QL, ST, AMSP. Empty when the PDL shows "-". */
  codes: string[];
}

export interface UmpIndex {
  /** The PDL's own "Last Updated" date. */
  lastUpdated: string;
  /** Tier -> cost sharing, from the PDL's first page (UMP Classic, Select, Achieve 1 and 2). */
  costs: Record<string, string>;
  /** The first page's sentences about the $35 cap on some Tier 2 drugs, in the PDL's own words. */
  costNotes: string[];
  entries: UmpEntry[];
}

// Column edges, in points, measured from the PDF's header row ("Drug Name" 18, "Special Code" 306, "Tier" 386, "Category" 426).
const CODE_X = [300, 380] as const;
const TIER_X = [380, 422] as const;
const NAME_MAX_X = 300;

/** Rebuilds the table rows on one Alphabetical Index page. */
export function parseIndexPage(items: PdfText[]): UmpEntry[] {
  const header = items.find((i) => i.str.trim() === "Drug Name");
  if (!header) return [];
  // Below the table: a legend box on some pages ("BRANDS =CAPITAL LETTERS", "NC =Not Covered") and a footer on every page.
  const footerY = Math.max(0, ...items.filter((i) => /^(BRANDS|=Not Covered|Coverage of medications)/.test(i.str.trim())).map((i) => i.y));
  const body = items.filter((i) => i.str.trim() && i.y < header.y - 2 && i.y > footerY + 3);
  const anchors = body.filter((i) => i.x >= CODE_X[0] && i.x < CODE_X[1]).sort((a, b) => b.y - a.y);
  // Cells are top-aligned, so an item belongs to the nearest anchor at or above it (allowing 3 points of jitter).
  const rowFor = (y: number) => {
    let row = -1;
    anchors.forEach((a, n) => {
      if (a.y >= y - 3) row = n;
    });
    return row;
  };
  const rows = anchors.map((a) => ({ name: [] as string[], tier: [] as string[], codes: a.str.trim() }));
  // Top to bottom, then left to right, so wrapped lines join in reading order.
  for (const i of [...body].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const n = rowFor(i.y);
    if (n === -1) continue;
    if (i.x < NAME_MAX_X) rows[n].name.push(i.str.trim());
    else if (i.x >= TIER_X[0] && i.x < TIER_X[1]) rows[n].tier.push(i.str.trim());
  }
  return rows.map((r) => {
    const entry = {
      name: r.name.join(" ").replace(/\s+/g, " ").trim(),
      // "Preventi" + "ve" is one word split across two lines; "Tier 2" + "Specialty" are two words.
      tier: r.tier.join(" ").replace("Preventi ve", "Preventive").trim(),
      codes: r.codes === "-" ? [] : r.codes.split("-").filter(Boolean),
    };
    // A row without a name or tier means the PDF layout moved; stop the refresh rather than drop a drug silently.
    if (!entry.name || !entry.tier) throw new Error(`UMP PDF layout changed: incomplete row ${JSON.stringify(entry)}`);
    return entry;
  });
}

/** The tiers and special codes the PDL's own legend defines. Anything else means the layout moved. */
export const UMP_TIERS = new Set(["Preventive", "Value", "Tier 1", "Tier 2", "Tier 1 Specialty", "Tier 2 Specialty"]);
export const UMP_LEGEND_CODES = new Set(["AMSP", "EXC", "LD", "LMSP", "M", "NC", "OTC", "PA", "QL", "RDX", "SF", "SMKG", "ST", "VAC"]);

/** Throws when a parsed row has a tier or code outside the legend, so a layout change stops the refresh. */
export function checkUmpIndex(index: UmpIndex): void {
  for (const e of index.entries) {
    if (!UMP_TIERS.has(e.tier)) throw new Error(`UMP PDF layout changed: unexpected tier "${e.tier}" for ${e.name}`);
    const bad = e.codes.find((c) => !UMP_LEGEND_CODES.has(c));
    if (bad) throw new Error(`UMP PDF layout changed: unexpected code "${bad}" for ${e.name}`);
  }
}

/** Sentences on the first page that mention the $35 cap (insulins, some inhalers and autoinjectors, some Tier 2 drugs). */
export function parseCostNotes(pageText: string): string[] {
  const notes: string[] = [];
  for (const raw of pageText.split(/\.\s+|\.(?=[A-Z])/)) {
    const at = raw.search(/\$\s*35/);
    if (at === -1) continue;
    // Cost-table rows ("Tier 2 30% coinsurance or $75 whichever is less") have no periods, so a sentence that
    // follows the table begins right after the last row's "whichever is less" before the $35.
    const rowEnd = raw.slice(0, at).lastIndexOf("whichever is less");
    const sentence = (rowEnd === -1 ? raw : raw.slice(rowEnd + "whichever is less".length)).replace(/\$\s*35\s*/g, "$35 ").replace(/\s+/g, " ").trim();
    notes.push(sentence.endsWith(".") ? sentence : `${sentence}.`);
  }
  return notes;
}

/** "Tier 1  10% coinsurance or $25 whichever is less" lines from the PDL's first page. */
export function parseCostTable(pageText: string): Record<string, string> {
  const costs: Record<string, string> = {};
  // pdf.js splits some amounts into pieces ("$", "7", "5"), so pieces are joined with no separator before matching.
  for (const m of pageText.matchAll(/(Preventive|Value|Tier 1|Tier 2)(?: Tier)?\s*(\$0|\d+% coinsurance or \$\d+\s*whichever is less)/g)) {
    costs[m[1]] ??= m[2].replace(/\s+/g, " ");
  }
  return costs;
}
