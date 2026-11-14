/**
 * Turns a drug name into RxNorm identifiers using NLM's free RxNav API, then finds the
 * NDCs for those identifiers. Every answer is cached on disk, as NLM asks, so repeat
 * lookups make no network calls. Only the drug name is sent; never anything about a patient.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cachePath } from "./sources.ts";

const RXNAV = "https://rxnav.nlm.nih.gov/REST";
/** Clinical and branded drugs and packs: the levels that formularies list. */
const PRODUCT_TTYS = new Set(["SCD", "SBD", "GPCK", "BPCK"]);

async function rxnav<T>(path: string): Promise<T> {
  const dir = cachePath("rxnav");
  const file = `${dir}/${createHash("sha256").update(path).digest("hex").slice(0, 24)}.json`;
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as T;
  const res = await fetch(`${RXNAV}${path}`, { headers: { "User-Agent": "wa-coverage-check/0.1" } });
  if (!res.ok) throw new Error(`RxNav ${path}: HTTP ${res.status}`);
  const body = (await res.json()) as T;
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(body));
  return body;
}

type ConceptGroup = { tty: string; conceptProperties?: { rxcui: string; name: string }[] };

export interface DrugMatch {
  /** How RxNorm read the name, for example "adalimumab" or "Humira". */
  matchedName: string;
  /** Product-level RxCUIs (every strength and form). */
  rxcuis: string[];
  /** RxNorm's name for each product, so a reader can see exactly what was matched. */
  products: { rxcui: string; name: string }[];
  /** 11-digit NDCs for those RxCUIs, as RxNorm currently lists them. */
  ndcs: string[];
}

/** Null when RxNorm does not recognize the name. */
export async function matchDrug(name: string): Promise<DrugMatch | null> {
  const query = name.trim();
  if (!query) return null;
  let groups = (await rxnav<{ drugGroup?: { conceptGroup?: ConceptGroup[] } }>(`/drugs.json?name=${encodeURIComponent(query)}`)).drugGroup?.conceptGroup ?? [];
  let matchedName = query;

  // Misspellings and partial names: ask RxNorm for its closest concept, then its products.
  if (!groups.some((g) => g.conceptProperties?.length)) {
    const best = (await rxnav<{ approximateGroup?: { candidate?: { rxcui: string; rank: string }[] } }>(`/approximateTerm.json?term=${encodeURIComponent(query)}&maxEntries=1`)).approximateGroup?.candidate?.[0];
    if (!best) return null;
    const props = await rxnav<{ properties?: { name: string } }>(`/rxcui/${best.rxcui}/properties.json`);
    matchedName = props.properties?.name ?? query;
    groups = (await rxnav<{ relatedGroup?: { conceptGroup?: ConceptGroup[] } }>(`/rxcui/${best.rxcui}/related.json?tty=SCD+SBD+GPCK+BPCK`)).relatedGroup?.conceptGroup ?? [];
  }

  const all = [...new Map(groups.filter((g) => PRODUCT_TTYS.has(g.tty)).flatMap((g) => (g.conceptProperties ?? []).map((c) => [c.rxcui, { rxcui: c.rxcui, name: c.name }] as const))).values()];
  if (!all.length) return null;
  // A search for one ingredient also returns combinations (atorvastatin brings in amlodipine/atorvastatin).
  // Keep single-ingredient products when there are any; keep everything when only combinations matched (the user typed one).
  const ingredientCount = async (rxcui: string) => {
    const res = await rxnav<{ relatedGroup?: { conceptGroup?: ConceptGroup[] } }>(`/rxcui/${rxcui}/related.json?tty=IN`);
    return (res.relatedGroup?.conceptGroup ?? []).flatMap((g) => g.conceptProperties ?? []).length;
  };
  const single: typeof all = [];
  for (const p of all) if ((await ingredientCount(p.rxcui)) === 1) single.push(p);
  const products = single.length ? single : all;
  const rxcuis = products.map((p) => p.rxcui);
  const ndcs = new Set<string>();
  for (const rxcui of rxcuis) {
    const res = await rxnav<{ ndcGroup?: { ndcList?: { ndc?: string[] } } }>(`/rxcui/${rxcui}/ndcs.json`);
    for (const ndc of res.ndcGroup?.ndcList?.ndc ?? []) ndcs.add(ndc);
  }
  return { matchedName, rxcuis, products, ndcs: [...ndcs] };
}
