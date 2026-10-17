import { cachedQuarterlyChanges } from "@/lib/data/cached";
import { formatMoney, formatPeriod } from "@/lib/format";
import { normalizeHcpcs } from "@/lib/hcpcs";
import { rss, type FeedItem } from "@/lib/rss";
import { SITE } from "@/lib/site";
import { quarterBounds } from "@/ingest/values";

export const dynamic = "force-dynamic";

const pct = (n: number) => `${n > 0 ? "+" : ""}${n}%`;

/**
 * GET /feeds/changes[?codes=J9312,Q5115] — RSS 2.0 feed of the latest two CMS quarters:
 * a summary per quarter, new and terminated drug codes, and (with `codes`) payment-limit
 * changes for those codes only. Codes in the URL are the only input; nothing is stored.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const codes = (url.searchParams.get("codes") ?? "")
    .split(/[\s,]+/)
    .map((c) => normalizeHcpcs(c))
    .filter((c): c is string => !!c)
    .slice(0, 50);
  const watch = new Set(codes);

  const latest = await cachedQuarterlyChanges(null);
  const quarters = latest.period ? [latest, ...(latest.previous ? [await cachedQuarterlyChanges(latest.previous)] : [])] : [];
  const items: FeedItem[] = [];
  for (const q of quarters) {
    if (!q.period) continue;
    const date = quarterBounds(q.period).start;
    const page = `${SITE.url}/tools/changes?period=${q.period}`;
    const drug = q.limitChanges.filter((c) => c.isDrug);
    items.push({
      title: `${formatPeriod(q.period)}: ${drug.length} drug payment limits changed, ${q.newCodes.length} new and ${q.terminatedCodes.length} terminated drug codes`,
      link: page,
      guid: `coderx-changes-${q.period}`,
      pubDate: date,
      category: "Quarter summary",
      description: `Medicare Part B payment limits for ${formatPeriod(q.period)} compared with ${q.previous ? formatPeriod(q.previous) : "the previous quarter"}. Largest increase: ${drug.find((c) => c.changePct > 0)?.code ?? "none"}; largest decrease: ${drug.find((c) => c.changePct < 0)?.code ?? "none"}. Source: CMS payment limit and HCPCS files.`,
    });
    for (const c of q.newCodes) {
      if (watch.size && !watch.has(c.code)) continue;
      items.push({ title: `New drug code ${c.code}: ${c.longDescription}`, link: `${SITE.url}/hcpcs/${c.code}`, guid: `coderx-new-${q.period}-${c.code}`, pubDate: date, category: "New code", description: `${c.code} first appears in the CMS HCPCS file for ${formatPeriod(q.period)}.` });
    }
    for (const c of q.terminatedCodes) {
      if (watch.size && !watch.has(c.code)) continue;
      items.push({ title: `Terminated: ${c.code} (${c.longDescription})`, link: `${SITE.url}/hcpcs/${c.code}`, guid: `coderx-term-${q.period}-${c.code}`, pubDate: date, category: "Terminated code", description: `CMS lists a termination date of ${c.terminationDate ?? "unknown"} for ${c.code}.` });
    }
    for (const c of watch.size ? drug.filter((x) => watch.has(x.code)) : drug.slice(0, 10)) {
      items.push({
        title: `${c.code} payment limit ${formatMoney(c.before)} → ${formatMoney(c.after)} (${pct(c.changePct)})`,
        link: `${SITE.url}/hcpcs/${c.code}#reimbursement`,
        guid: `coderx-limit-${q.period}-${c.code}`,
        pubDate: date,
        category: "Payment limit",
        description: `${c.shortDescription ?? c.code}: Medicare Part B payment limit per ${c.dosage ?? "billing unit"} ${formatMoney(c.before)} in ${q.previous ? formatPeriod(q.previous) : "the previous quarter"} → ${formatMoney(c.after)} in ${formatPeriod(q.period)}.`,
      });
    }
  }

  const body = rss({
    title: codes.length ? `${SITE.name}: changes for ${codes.slice(0, 5).join(", ")}${codes.length > 5 ? "…" : ""}` : `${SITE.name}: quarterly drug coding and payment changes`,
    link: `${SITE.url}/tools/changes`,
    description: "Quarterly Medicare Part B payment-limit changes and new or terminated drug HCPCS codes, from CMS files.",
    selfUrl: `${SITE.url}/feeds/changes${codes.length ? `?codes=${codes.join(",")}` : ""}`,
    items,
  });
  return new Response(body, { headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400" } });
}
