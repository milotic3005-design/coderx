import Papa from "papaparse";

/** Parse CSV text into raw string rows (quoted multi-line cells supported). */
export function parseCsvRows(text: string): string[][] {
  const result = Papa.parse<string[]>(text, { skipEmptyLines: false });
  return result.data.map((row) => row.map((cell) => (cell ?? "").replace(/ /g, " ")));
}

/** Lowercase, collapse whitespace — used to match header names robustly. */
export function headerKey(cell: string): string {
  return cell.trim().toLowerCase().replace(/\s+/g, " ");
}

export function findHeaderRow(rows: string[][], predicate: (keys: string[]) => boolean, searchLimit = 60): number {
  for (let i = 0; i < Math.min(rows.length, searchLimit); i++) {
    if (predicate(rows[i].map(headerKey))) return i;
  }
  return -1;
}

/** Build a column lookup: first header whose key is in `aliases`. */
export function columnFinder(header: string[]) {
  const keys = header.map(headerKey);
  return (...aliases: string[]): number => {
    for (const alias of aliases) {
      const i = keys.indexOf(alias);
      if (i >= 0) return i;
    }
    return -1;
  };
}

export function cell(row: string[], index: number): string {
  return index >= 0 ? (row[index] ?? "").trim() : "";
}

export function isBlankRow(row: string[]): boolean {
  return row.every((c) => !c || !c.trim());
}
