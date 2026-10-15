/** Text normalization shared by ingestion (index build) and search (query parsing). */

/** Lowercase, strip diacritics and trademark symbols, turn punctuation into single spaces. */
export function normalizeText(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[®™©]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Words that carry no search signal inside HCPCS descriptors and product names. */
export const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "each",
  "for",
  "in",
  "inj",
  "injection",
  "of",
  "on",
  "or",
  "per",
  "the",
  "to",
  "up",
  "with",
  "w",
  "mg",
  "mcg",
  "ml",
  "g",
  "gm",
  "unit",
  "units",
  "iu",
  "dose",
  "doses",
  "use",
  "used",
  "only",
  "includes",
  "include",
  "excludes",
  "other",
  "than",
  "this",
  "code",
]);

export function tokenize(input: string | null | undefined): string[] {
  const norm = normalizeText(input);
  return norm ? norm.split(" ") : [];
}

const NEGATIONS = new Set(["excludes", "excluding", "except", "without", "not", "non"]);

/**
 * Tokens worth indexing: non-stopwords, at least 3 characters, not pure numbers.
 * A word directly after a negation ("excludes biosimilar", "not biosimil") is
 * skipped so a search for "biosimilar" does not match codes that exclude them.
 */
export function indexTokens(input: string | null | undefined): string[] {
  const tokens = tokenize(input);
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (NEGATIONS.has(t)) {
      i++;
      continue;
    }
    if (t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t)) out.push(t);
  }
  return [...new Set(out)];
}

export function slugify(input: string, maxLength = 96): string {
  const slug = normalizeText(input).replace(/ /g, "-");
  return slug.length > maxLength ? slug.slice(0, maxLength).replace(/-+[^-]*$/, "") || slug.slice(0, maxLength) : slug;
}

/**
 * Display helper: labelers sometimes submit names in all capitals. Title-case those
 * for headings only; the original value is always shown in the data tables.
 */
export function displayCase(input: string): string {
  const letters = input.replace(/[^A-Za-z]/g, "");
  if (letters.length < 4 || letters !== letters.toUpperCase()) return input;
  return input.toLowerCase().replace(/(^|[\s\-/(])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase());
}

/** Escape LIKE wildcards in user input so "%" and "_" are matched literally. */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export function uniq<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

export function compact<T>(values: (T | null | undefined | "")[]): T[] {
  return values.filter((v): v is T => v !== null && v !== undefined && v !== "");
}
