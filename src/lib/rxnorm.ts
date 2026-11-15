/**
 * Turns a drug name into RxNorm product IDs (RxCUIs) and NDCs with NLM's free RxNav API, for the
 * Washington coverage tool. Only the drug name is sent. A name RxNorm does not know exactly is not
 * guessed: RxNav's closest names come back as suggestions for the reader to choose.
 * Ported from wa-coverage-check/src/rxnorm.ts.
 */
import type { DrugMatch } from "./wa-coverage";

const RXNAV = "https://rxnav.nlm.nih.gov/REST";
/** Clinical and branded drugs and packs: the levels that formularies list. */
const PRODUCT_TTYS = new Set(["SCD", "SBD", "GPCK", "BPCK"]);
/** A name with more products than this is too broad to look up (for example "insulin"). */
export const MAX_PRODUCTS = 150;
/** NLM asks for no more than 20 requests per second per user; three at a time stays near that. */
const CONCURRENCY = 3;
/** NLM recommends caching results for 12-24 hours. */
export const RXNAV_CACHE_SECONDS = 24 * 60 * 60;

/**
 * An RxNav failure. It deliberately carries no `cause`: a DNS or socket code there (ENOTFOUND, ETIMEDOUT…)
 * would make src/lib/db/availability.ts read an NLM outage as a database outage and pause the database.
 */
export class RxNavError extends Error {
  constructor(path: string, detail: string) {
    super(`RxNav unavailable (${path.split("?")[0]}): ${detail}`);
    this.name = "RxNavError";
  }
}

export type RxNormResult =
  | { kind: "match"; match: DrugMatch }
  | { kind: "suggestions"; suggestions: string[] }
  | { kind: "too-broad"; products: number }
  | { kind: "none" };

async function rxnav<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${RXNAV}${path}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000), next: { revalidate: RXNAV_CACHE_SECONDS } });
  } catch (error) {
    throw new RxNavError(path, error instanceof Error ? error.name : "network error");
  }
  if (!res.ok) throw new RxNavError(path, `HTTP ${res.status}`);
  try {
    return (await res.json()) as T;
  } catch {
    throw new RxNavError(path, "response was not JSON");
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

type ConceptGroup = { tty: string; conceptProperties?: { rxcui: string; name: string }[] };

export async function matchRxNorm(name: string): Promise<RxNormResult> {
  const query = name.trim().slice(0, 100);
  if (!query) return { kind: "none" };
  const groups = (await rxnav<{ drugGroup?: { conceptGroup?: ConceptGroup[] } }>(`/drugs.json?name=${encodeURIComponent(query)}`)).drugGroup?.conceptGroup ?? [];
  const all = [...new Map(groups.filter((g) => PRODUCT_TTYS.has(g.tty)).flatMap((g) => (g.conceptProperties ?? []).map((c) => [c.rxcui, { rxcui: c.rxcui, name: c.name }] as const))).values()];

  if (!all.length) {
    // Misspellings and partial names: offer RxNorm's closest names instead of picking one.
    const candidates = (await rxnav<{ approximateGroup?: { candidate?: { rxcui: string; name?: string; source?: string }[] } }>(`/approximateTerm.json?term=${encodeURIComponent(query)}&maxEntries=8`)).approximateGroup?.candidate ?? [];
    // Only RxNorm's own names: names from other vocabularies may not look up exactly.
    const seen = new Set<string>();
    const names = candidates
      .filter((c) => c.source === "RXNORM")
      .map((c) => c.name?.trim())
      .filter((n): n is string => !!n && n.length <= 60 && !seen.has(n.toLowerCase()) && !!seen.add(n.toLowerCase()))
      .slice(0, 5);
    return names.length ? { kind: "suggestions", suggestions: names } : { kind: "none" };
  }
  if (all.length > MAX_PRODUCTS) return { kind: "too-broad", products: all.length };

  // A search for one ingredient also returns combinations (atorvastatin brings in amlodipine/atorvastatin).
  // Keep single-ingredient products when there are any; keep everything when only combinations matched (the reader typed one).
  // Each product's RxNorm ingredients (IN), also used to recognize insulin, whose cost sharing follows its own rules.
  const ingredients = await mapLimit(all, CONCURRENCY, async (p) => {
    const res = await rxnav<{ relatedGroup?: { conceptGroup?: ConceptGroup[] } }>(`/rxcui/${p.rxcui}/related.json?tty=IN`);
    return (res.relatedGroup?.conceptGroup ?? []).flatMap((g) => g.conceptProperties ?? []).map((c) => c.name);
  });
  const withIngredients = all.map((p, i) => ({ ...p, ingredients: ingredients[i] }));
  const single = withIngredients.filter((p) => p.ingredients.length === 1);
  const products = single.length ? single : withIngredients;
  const ndcLists = await mapLimit(products, CONCURRENCY, async (p) => (await rxnav<{ ndcGroup?: { ndcList?: { ndc?: string[] } } }>(`/rxcui/${p.rxcui}/ndcs.json`)).ndcGroup?.ndcList?.ndc ?? []);
  const ndcs = [...new Set(ndcLists.flat().filter((n) => /^\d{11}$/.test(n)))];
  return { kind: "match", match: { matchedName: query, rxcuis: products.map((p) => p.rxcui), products, ndcs } };
}
