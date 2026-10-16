/** Build a CSV (RFC 4180 quoting) and hand it to the browser as a download. Runs client-side only. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function downloadCsv(fileName: string, rows: (string | number | null | undefined)[][]) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Read a user-selected text file in the browser (it is never uploaded). */
export function readTextFile(file: File, maxBytes = 1_000_000): Promise<string> {
  if (file.size > maxBytes) return Promise.reject(new Error(`The file is ${Math.round(file.size / 1024)} KB; the limit is ${Math.round(maxBytes / 1024)} KB.`));
  return file.text();
}
