/**
 * Cross-request caching for read models. Inside the Next.js server the results are
 * stored in the Data Cache (tag `coderx-data`, invalidated after every import);
 * elsewhere (CLI, tests) the functions run uncached.
 */
import { unstable_cache } from "next/cache";
import { getDrugDetail, getFamilyCounts, getFamilyListing, getHcpcsDetail, getHomeData, getManufacturerDetail, getNdcDetail, getSourcesOverview } from "./queries";
import { biosimilarGroups, quarterlyChanges } from "./tools";

export const DATA_TAG = "coderx-data";
const SIX_HOURS = 6 * 60 * 60;

function cached<A extends unknown[], R>(fn: (...args: A) => Promise<R>, key: string): (...args: A) => Promise<R> {
  if (!process.env.NEXT_RUNTIME || process.env.CODERX_DISABLE_DATA_CACHE === "1") return fn;
  return unstable_cache(fn, [`coderx:${key}:v3`], { tags: [DATA_TAG], revalidate: SIX_HOURS });
}

export const cachedHcpcsDetail = cached((code: string) => getHcpcsDetail(code), "hcpcs");
export const cachedDrugDetail = cached((slug: string) => getDrugDetail(slug), "drug");
export const cachedNdcDetail = cached((ndc11: string) => getNdcDetail(ndc11), "ndc");
export const cachedManufacturerDetail = cached((id: string) => getManufacturerDetail(id), "manufacturer");
export const cachedHomeData = cached(() => getHomeData(), "home");
export const cachedSources = cached(() => getSourcesOverview(), "sources");
export const cachedFamilyCounts = cached(() => getFamilyCounts(), "family-counts");
export const cachedFamilyListing = cached(
  (letter: string, page: number, pageSize: number, status: "active" | "inactive" | "all", drugOnly: boolean) =>
    getFamilyListing(letter, { page, pageSize, status, drugOnly }),
  "family-listing",
);
export const cachedBiosimilarGroups = cached(() => biosimilarGroups(), "biosimilars");
export const cachedQuarterlyChanges = cached((period: string | null) => quarterlyChanges(period), "changes");
