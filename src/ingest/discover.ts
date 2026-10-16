/**
 * Discover the newest releases by reading the publishers' public landing pages.
 * Only links on the official CMS/FDA domains are accepted.
 */
import { fetchPage } from "./fetch";
import type { MueSourceKey, ReleaseCandidate, SourceKey } from "./sources";
import { MUE_SOURCES, SOURCES } from "./sources";
import { parseLongDate, parseUsDate, periodFromMonthYear } from "./values";

interface Link {
  href: string;
  text: string;
  trailing: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&ndash;|&#8211;/g, "–")
    .replace(/&mdash;|&#8212;/g, "—")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

export function extractLinks(html: string, base: string): Link[] {
  const links: Link[] = [];
  const re = /<a\b[^>]*href\s*=\s*["']\s*([^"']+?)\s*["'][^>]*>([\s\S]*?)<\/a>([\s\S]{0,240}?)(?=<a\b|<\/p>|<\/li>|<br|$)/gi;
  for (const m of html.matchAll(re)) {
    let href: string;
    try {
      href = new URL(decodeEntities(m[1]), base).toString();
    } catch {
      continue;
    }
    links.push({ href, text: stripTags(m[2]), trailing: stripTags(m[3]) });
  }
  return links;
}

function latestUsDate(text: string): string | null {
  const dates = [...text.matchAll(/\b(\d{1,2}\/\d{1,2}\/(?:\d{4}|\d{2}))\b/g)].map((m) => parseUsDate(m[1])).filter((d): d is string => !!d);
  return dates.sort().at(-1) ?? null;
}

function isOfficial(url: string, hosts: string[]): boolean {
  try {
    return hosts.includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Parse the CMS HCPCS quarterly-update page. */
export function parseHcpcsLandingPage(html: string): ReleaseCandidate[] {
  return extractLinks(html, "https://www.cms.gov")
    .filter((l) => /alpha-numeric hcpcs file/i.test(l.text) && /\.zip(\?|$)/i.test(l.href) && isOfficial(l.href, ["www.cms.gov"]))
    .map((l) => ({
      sourceKey: "cms_hcpcs" as const,
      period: periodFromMonthYear(l.text),
      url: l.href,
      publicationLabel: l.trailing.replace(/^[\s\-–—]+/, "") || null,
      publicationDate: latestUsDate(l.trailing),
    }))
    .filter((c) => c.period);
}

/** Parse the CMS ASP pricing-files page (payment limit files and crosswalks). */
export function parseAspLandingPage(html: string): ReleaseCandidate[] {
  const out: ReleaseCandidate[] = [];
  for (const l of extractLinks(html, "https://www.cms.gov")) {
    if (!/\.zip(\?|$)/i.test(l.href) || !isOfficial(l.href, ["www.cms.gov"])) continue;
    if (/seasonal|vaccine/i.test(l.text)) continue;
    let sourceKey: SourceKey | null = null;
    if (/ndc[\s-]*hcpcs crosswalk/i.test(l.text)) sourceKey = "cms_ndc_hcpcs";
    else if (/payment limit file|asp pricing file/i.test(l.text)) sourceKey = "cms_payment_limits";
    if (!sourceKey) continue;
    const period = periodFromMonthYear(l.text);
    if (!period) continue;
    out.push({
      sourceKey,
      period,
      url: l.href,
      publicationLabel: l.trailing.replace(/^[\s\-–—]+/, "") || null,
      publicationDate: latestUsDate(l.trailing),
    });
  }
  return out;
}

/** Parse the Purple Book downloads page; returns the newest monthly CSV. */
export function parsePurpleBookDownloads(html: string): ReleaseCandidate[] {
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const out: ReleaseCandidate[] = [];
  for (const l of extractLinks(html, "https://purplebooksearch.fda.gov/downloads")) {
    const m = l.href.match(/PurpleBook\/(\d{4})\/purplebook-search-([a-z]+)-data-download\.csv$/i);
    if (!m || !isOfficial(l.href, ["www.accessdata.fda.gov"])) continue;
    const month = months.indexOf(m[2].toLowerCase()) + 1;
    if (!month) continue;
    out.push({
      sourceKey: "fda_purple_book",
      period: `${m[1]}-${String(month).padStart(2, "0")}`,
      url: l.href,
      publicationLabel: `${m[2][0].toUpperCase()}${m[2].slice(1).toLowerCase()} ${m[1]} data download`,
    });
  }
  return out.sort((a, b) => (a.period ?? "").localeCompare(b.period ?? ""));
}

const MUE_FILE_RE = /\/files\/zip\/medicare-ncci-(\d{4})-q([1-4])-(practitioner|facility-outpatient-hospital|dme-supplier)-services-mue-table\.zip/gi;

/**
 * Parse the CMS MUE page. The full-table links are matched on their file names
 * (the page's link markup nests anchors, so link text is unreliable); the quarterly
 * "additions, deletions, and revisions" files are not needed and are ignored.
 */
export function parseMueLandingPage(html: string): ReleaseCandidate[] {
  const out = new Map<string, ReleaseCandidate>();
  for (const m of html.matchAll(MUE_FILE_RE)) {
    const sourceKey = (Object.keys(MUE_SOURCES) as MueSourceKey[]).find((k) => MUE_SOURCES[k].fileSlug === m[3].toLowerCase());
    if (!sourceKey) continue;
    const url = new URL(m[0], "https://www.cms.gov").toString();
    const posted = html.slice(m.index ?? 0, (m.index ?? 0) + 600).match(/Effective\s+([A-Z][a-z]+ \d{1,2}, \d{4});\s*Posted\s+([A-Z][a-z]+ \d{1,2}, \d{4})/);
    out.set(url, {
      sourceKey,
      period: `${m[1]}-Q${m[2]}`,
      url,
      publicationLabel: posted ? `Effective ${posted[1]}; Posted ${posted[2]}` : null,
      publicationDate: posted ? parseLongDate(posted[2]) : null,
    });
  }
  return [...out.values()];
}

export async function discoverReleases(): Promise<{ candidates: ReleaseCandidate[]; errors: string[] }> {
  const errors: string[] = [];
  const candidates: ReleaseCandidate[] = [];
  const tasks: [string, (html: string) => ReleaseCandidate[]][] = [
    [SOURCES.cms_hcpcs.landingPageUrl, parseHcpcsLandingPage],
    [SOURCES.cms_payment_limits.landingPageUrl, parseAspLandingPage],
    [SOURCES.fda_purple_book.landingPageUrl, parsePurpleBookDownloads],
    [SOURCES.cms_mue_practitioner.landingPageUrl, parseMueLandingPage],
  ];
  await Promise.all(
    tasks.map(async ([url, parse]) => {
      try {
        candidates.push(...parse(await fetchPage(url)));
      } catch (error) {
        errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
  );
  return { candidates, errors };
}
