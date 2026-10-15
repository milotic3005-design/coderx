import type { MetadataRoute } from "next";
import { getSitemapEntries } from "@/lib/data/queries";
import { SITE } from "@/lib/site";

export const dynamic = "force-dynamic";
export const revalidate = 86400;

/** Indexable pages: static pages, drug-related HCPCS codes, drugs with CMS coding, manufacturers. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const fixed = ["", "/codes", "/calculator", "/sources", "/methodology", "/privacy", "/terms", "/codes/j", "/codes/q", "/codes/c", "/codes/a", "/codes/p", "/codes/s"].map((p) => ({
    url: `${SITE.url}${p}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: p === "" ? 1 : 0.6,
  }));
  try {
    const e = await getSitemapEntries();
    return [
      ...fixed,
      ...e.codes.map((c) => ({ url: `${SITE.url}/hcpcs/${c}`, changeFrequency: "monthly" as const, priority: 0.8 })),
      ...e.drugs.map((s) => ({ url: `${SITE.url}/drugs/${s}`, changeFrequency: "monthly" as const, priority: 0.7 })),
      ...e.manufacturers.map((s) => ({ url: `${SITE.url}/manufacturers/${s}`, changeFrequency: "monthly" as const, priority: 0.4 })),
    ];
  } catch {
    return fixed;
  }
}
