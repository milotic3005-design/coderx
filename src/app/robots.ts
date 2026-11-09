import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

/**
 * Crawlers get the record pages (listed in the sitemap) and the tools' landing pages, but not the URLs that take
 * a query string: every drug code and unit count makes a new calculator or tool URL, and crawling them kept the
 * database awake around the clock (it ran out of its monthly compute quota on 2026-11-08). The explicit prefixes
 * cover crawlers that do not support the `*` wildcard.
 */
const QUERY_PAGES = ["/calculator?", "/tools/site-of-care?", "/tools/part-b-vs-d?", "/tools/intake?", "/tools/price-benchmark?", "/tools/biosimilars?", "/tools/changes?"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/search", ...QUERY_PAGES, "/*?"] }],
    sitemap: `${SITE.url}/sitemap.xml`,
    host: SITE.url,
  };
}
