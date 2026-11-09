/**
 * Cross-request caching for read models. Inside the Next.js server the results are
 * stored in the Data Cache (tag `coderx-data`, invalidated after every import);
 * elsewhere (CLI, tests) the functions run uncached.
 *
 * When the database cannot answer (Neon over its plan quota, a dropped connection),
 * each reader falls back to the most recent earlier day's copy still in the cache, so
 * pages people already visited keep working through an outage.
 */
import { unstable_cache } from "next/cache";
import { todayUs } from "@/lib/dates";
import { isDatabaseUnavailable, pauseDatabase } from "@/lib/db/availability";
import { getCoverageArticle, getDrugDetail, getFamilyCounts, getFamilyListing, getHcpcsDetail, getHomeData, getManufacturerDetail, getNdcDetail, getSitemapEntries, getSourcesOverview } from "./queries";
import { benefitData } from "./benefit";
import { biosimilarGroups, quarterlyChanges, siteOfCareData } from "./tools";

export const DATA_TAG = "coderx-data";
const SIX_HOURS = 6 * 60 * 60;
/** How far back an outage may reach for a saved copy (Neon's free quota resets monthly). */
export const FALLBACK_DAYS = 31;

function cached<A extends unknown[], R>(fn: (...args: A) => Promise<R>, key: string): (...args: A) => Promise<R> {
  if (!process.env.NEXT_RUNTIME || process.env.CODERX_DISABLE_DATA_CACHE === "1") return fn;
  // The day is part of the cache key so active/terminated status turns over at midnight.
  const store = unstable_cache((_day: string, ...args: A) => fn(...args), [`coderx:${key}:v4`], { tags: [DATA_TAG], revalidate: SIX_HOURS });
  return (...args: A) => readThrough(store, args, key);
}

/** YYYY-MM-DD for the `count` days before `day`, newest first. */
export function previousDays(day: string, count: number): string[] {
  const t = Date.parse(`${day}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => new Date(t - (i + 1) * 86_400_000).toISOString().slice(0, 10));
}

/** Today's copy; if the database is unavailable, the newest earlier day's copy (stale but real data), else the error. */
export async function readThrough<A extends unknown[], R>(store: (day: string, ...args: A) => Promise<R>, args: A, key: string, today = todayUs()): Promise<R> {
  try {
    return await store(today, ...args);
  } catch (error) {
    if (!isDatabaseUnavailable(error)) throw error;
    // Later misses in this process now fail at once instead of reaching the database again.
    pauseDatabase();
    for (const day of previousDays(today, FALLBACK_DAYS)) {
      try {
        const value = await store(day, ...args);
        console.warn(JSON.stringify({ level: "warn", scope: "data.cache", message: `Database unavailable; served the ${key} copy from ${day}.` }));
        return value;
      } catch {
        // No copy saved that day.
      }
    }
    throw error;
  }
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
export const cachedSiteOfCare = cached((code: string) => siteOfCareData(code), "site-of-care");
export const cachedBenefit = cached((code: string, slug: string) => benefitData({ code: code || undefined, slug: slug || undefined }), "benefit");
export const cachedSitemapEntries = cached(() => getSitemapEntries(), "sitemap");
export const cachedCoverageArticle = cached((displayId: string) => getCoverageArticle(displayId), "coverage-article");
