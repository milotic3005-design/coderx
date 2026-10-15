/**
 * Government files arrive in mixed encodings (FDA product.txt is Latin-1 while
 * package.txt is UTF-8; CMS CSVs are usually Windows-1252). Decode as UTF-8 when the
 * bytes are valid UTF-8, otherwise as Windows-1252, and report which was used.
 */
export function decodeText(bytes: Uint8Array): { text: string; encoding: "utf-8" | "windows-1252" } {
  let text: string;
  let encoding: "utf-8" | "windows-1252";
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    encoding = "utf-8";
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
    encoding = "windows-1252";
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return { text, encoding };
}

/** Split into lines, tolerating CRLF and a trailing newline. */
export function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}
