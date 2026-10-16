/**
 * Build test fixtures as byte-faithful excerpts of real CMS/FDA files.
 *
 *   npm run fixtures -- <raw-dir>
 *
 * <raw-dir> holds the original downloads (layout used during discovery):
 *   hcpcs-2026q4/, hist/hc-2025q4/, asp-2026q4/, hist/asp-2026q3/, xwalk-2026q4/,
 *   fda-ndc/, fda-ndc-excluded/, purplebook/pb.csv, mue-2026q4/ (the three MCR_MUE_*.csv tables)
 *
 * Header/preamble rows are kept verbatim; only data rows for a fixed list of
 * codes/NDCs are retained. No values are edited or invented.
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RAW = process.argv[2];
if (!RAW) {
  console.error("usage: npm run fixtures -- <raw-dir>");
  process.exit(1);
}
const OUT = join(process.cwd(), "tests/fixtures");
mkdirSync(OUT, { recursive: true });

export const FIXTURE_CODES = [
  "J9271", "J9277", "J9312", "J9311", "Q5115", "Q5119", "Q5123",
  "J1745", "Q5103", "Q5104", "Q5121", "J0897", "Q5158",
  "J1100", "J8540", "J7312", "J1096", "J8541",
  "J3490", "J9999", "J3590", "C9399", "S0189", "C9027", "J9020", "A9606", "J0585",
];

const lines = (file: string) => readFileSync(file, "latin1").split(/\r?\n/);
const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const provenance: string[] = [];

function find(dir: string, re: RegExp): string {
  const f = readdirSync(dir).find((n) => re.test(n));
  if (!f) throw new Error(`No file matching ${re} in ${dir}`);
  return join(dir, f);
}

// --- HCPCS fixed-width (two quarters for history) ---
for (const [dir, out] of [
  ["hist/hc-2025q4", "hcpcs-2025q4.txt"],
  ["hcpcs-2026q4", "hcpcs-2026q4.txt"],
] as const) {
  const src = find(join(RAW, dir), /ANWEB.*\.txt$/i);
  const kept = lines(src).filter((l) => l.length >= 11 && FIXTURE_CODES.includes(l.slice(0, 5)) && (l[10] === "3" || l[10] === "4"));
  writeFileSync(join(OUT, out), kept.join("\r\n") + "\r\n", "latin1");
  provenance.push(`${out}: ${kept.length} lines from ${dir}/${src.split("/").pop()} (sha256 ${sha(src)})`);
}
copyFileSync(find(join(RAW, "hcpcs-2026q4"), /NOC codes.*\.xlsx$/i), join(OUT, "noc-codes-2026q4.xlsx"));
provenance.push(`noc-codes-2026q4.xlsx: unmodified copy of the CMS NOC code list (October 2026)`);

// --- CSV excerpts: keep whole records (quoted cells may span lines) with their original bytes ---
/** Group physical lines (terminators kept) into logical CSV records using quote parity. */
function csvRecords(text: string): string[] {
  const out: string[] = [];
  let buf = "";
  let quotes = 0;
  for (const line of text.split(/(?<=\n)/)) {
    buf += line;
    quotes += (line.match(/"/g) ?? []).length;
    if (quotes % 2 === 0) {
      out.push(buf);
      buf = "";
      quotes = 0;
    }
  }
  if (buf) out.push(buf);
  return out.map((r) => (/\n$/.test(r) ? r : `${r}\r\n`));
}

function csvExcerpt(src: string, out: string, headerTest: (record: string) => boolean, keep: (record: string) => boolean) {
  const all = csvRecords(readFileSync(src, "latin1"));
  const h = all.findIndex(headerTest);
  if (h < 0) throw new Error(`header not found in ${src}`);
  const rows = all.slice(h + 1).filter(keep);
  writeFileSync(join(OUT, out), [...all.slice(0, h + 1), ...rows].join(""), "latin1");
  provenance.push(`${out}: preamble + ${rows.length} records from ${src.split("/").pop()} (sha256 ${sha(src)})`);
}

const startsWithCode = (codes: string[]) => (line: string) => codes.some((c) => line.startsWith(`${c},`));

csvExcerpt(
  find(join(RAW, "asp-2026q4"), /508.*Payment Limit File.*\.csv$/i),
  "payment-2026q4.csv",
  (l) => l.startsWith("HCPCS Code,"),
  startsWithCode([...FIXTURE_CODES, "90371"]),
);
csvExcerpt(
  find(join(RAW, "hist/asp-2026q3"), /508.*Payment Limit File.*\.csv$/i),
  "payment-2026q3.csv",
  (l) => l.startsWith("HCPCS Code,"),
  startsWithCode(FIXTURE_CODES),
);
csvExcerpt(find(join(RAW, "asp-2026q4"), /508.*Not Payable.*\.csv$/i), "not-payable-2026q4.csv", (l) => l.startsWith("HCPCS Code,"), () => true);

const xwSrc = find(join(RAW, "xwalk-2026q4"), /508.*ASP NDC-HCPCS Crosswalk.*\.csv$/i);
csvExcerpt(xwSrc, "crosswalk-asp-2026q4.csv", (l) => l.startsWith("_2026_CODE,"), startsWithCode([...FIXTURE_CODES, "90371"]));
csvExcerpt(
  find(join(RAW, "xwalk-2026q4"), /508.*OPPS NDC-HCPCS Crosswalk.*\.csv$/i),
  "crosswalk-opps-2026q4.csv",
  (l) => l.startsWith("_2026_CODE,"),
  startsWithCode(["A9513", "C9399"]),
);

// NDCs referenced by the crosswalk excerpt (11-digit, 5-4-2).
const xwNdcs = new Set(
  readFileSync(join(OUT, "crosswalk-asp-2026q4.csv"), "latin1")
    .split(/\r?\n/)
    .map((l) => l.match(/,(\d{5}-\d{4}-\d{2}),/)?.[1])
    .filter((x): x is string => !!x),
);
const to11 = (pkg: string) => {
  const [a, b, c] = pkg.split("-");
  return a && b && c ? `${a.padStart(5, "0")}-${b.padStart(4, "0")}-${c.padStart(2, "0")}` : "";
};

// --- FDA NDC Directory: packages in the crosswalk excerpt + a non-crosswalked SC biologic (Humira) ---
function tsvExcerpt(src: string, out: string, keep: (cols: string[], header: string[]) => boolean) {
  const all = readFileSync(src, "latin1").split(/\r?\n/);
  const header = all[0].split("\t");
  const rows = all.slice(1).filter((l) => l && keep(l.split("\t"), header));
  writeFileSync(join(OUT, out), [all[0], ...rows].join("\n") + "\n", "latin1");
  provenance.push(`${out}: header + ${rows.length} rows from ${src.split("/").pop()} (sha256 ${sha(src)})`);
  return rows.map((r) => r.split("\t"));
}

const pkgRows = tsvExcerpt(join(RAW, "fda-ndc/package.txt"), "fda-package.txt", (cols, h) => {
  const ndc = to11(cols[h.indexOf("NDCPACKAGECODE")]);
  return xwNdcs.has(ndc) || cols[h.indexOf("PRODUCTNDC")] === "0074-0554";
});
const productIds = new Set(pkgRows.map((r) => r[0]));
tsvExcerpt(join(RAW, "fda-ndc/product.txt"), "fda-product.txt", (cols) => productIds.has(cols[0]));

const exPkgs = tsvExcerpt(join(RAW, "fda-ndc-excluded/Packages_excluded.txt"), "fda-packages-excluded.txt", (cols, h) => xwNdcs.has(to11(cols[h.indexOf("NDCPACKAGECODE")])));
const exIds = new Set(exPkgs.map((r) => r[0]));
tsvExcerpt(join(RAW, "fda-ndc-excluded/Products_excluded.txt"), "fda-products-excluded.txt", (cols) => exIds.has(cols[0]));

// --- NCCI MUE tables (2026-Q4): AMA notice + header kept verbatim; fixture codes plus two CPT rows (dropped on import) ---
for (const [file, out] of [
  [/MCR_MUE_PractitionerServices.*\.csv$/i, "mue-practitioner-2026q4.csv"],
  [/MCR_MUE_OutpatientHospitalServices.*\.csv$/i, "mue-outpatient-2026q4.csv"],
  [/MCR_MUE_DMESupplierServices.*\.csv$/i, "mue-dme-2026q4.csv"],
] as const) {
  csvExcerpt(find(join(RAW, "mue-2026q4"), file), out, (r) => /^"HCPCS\/\r?\nCPT Code",/.test(r), startsWithCode([...FIXTURE_CODES, "J1569", "J2783", "A4206", "0001U", "96365"]));
}

// --- Purple Book: both section headers + rows for the fixture biologics ---
{
  const src = join(RAW, "purplebook/pb.csv");
  const all = readFileSync(src, "utf8").split(/\r?\n/);
  const lastHeader = all.map((l, i) => (l.startsWith("N/R/U,") ? i : -1)).filter((i) => i >= 0).at(-1)!;
  const keep = (l: string) => /,(rituximab|infliximab|denosumab|pembrolizumab|adalimumab)[^,]*,/i.test(l);
  const rows = all.slice(lastHeader + 1).filter(keep);
  writeFileSync(join(OUT, "purplebook.csv"), [...all.slice(0, 4), ...all.slice(lastHeader - 1, lastHeader + 1), ...rows].join("\n") + "\n", "utf8");
  provenance.push(`purplebook.csv: title/section rows + ${rows.length} product rows from ${src.split("/").pop()} (sha256 ${sha(src)})`);
}

writeFileSync(
  join(OUT, "PROVENANCE.md"),
  `# Test fixture provenance\n\nGenerated ${new Date().toISOString().slice(0, 10)} by \`npm run fixtures\` from files downloaded directly from CMS and FDA on 2026-10-14.\nEach fixture keeps the original header/preamble and a subset of unmodified data rows.\n\n${provenance.map((p) => `- ${p}`).join("\n")}\n`,
);
console.log(provenance.join("\n"));
