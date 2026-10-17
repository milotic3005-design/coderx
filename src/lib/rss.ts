/** Minimal RSS 2.0 writer (no dependencies). */
export interface FeedItem {
  title: string;
  link: string;
  guid: string;
  description: string;
  pubDate: string;
  category?: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export function rss(channel: { title: string; link: string; description: string; selfUrl: string; items: FeedItem[] }): string {
  const items = channel.items
    .map(
      (i) => `    <item>
      <title>${esc(i.title)}</title>
      <link>${esc(i.link)}</link>
      <guid isPermaLink="false">${esc(i.guid)}</guid>
      <pubDate>${new Date(i.pubDate).toUTCString()}</pubDate>${i.category ? `\n      <category>${esc(i.category)}</category>` : ""}
      <description>${esc(i.description)}</description>
    </item>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(channel.title)}</title>
    <link>${esc(channel.link)}</link>
    <description>${esc(channel.description)}</description>
    <language>en-us</language>
    <atom:link href="${esc(channel.selfUrl)}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;
}
