import { ArrowUpRight, CircleAlert, CircleCheck, CircleX, Rss, Star, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { TOOLS } from "@/lib/tools";

/* Small, decorative previews of each tool's output (hidden from assistive tech; the card text carries the meaning). */

function CalculatorPreview() {
  return (
    <div className="mt-5 space-y-3">
      <p className="text-[0.7rem] font-semibold tracking-wider text-ink-faint uppercase">Example · J9312 rituximab, 1,250.5 mg</p>
      <div className="grid grid-cols-3 gap-2">
        {[
          ["126", "units"],
          ["4", "JW units"],
          ["≤ 150", "MUE / day"],
        ].map(([v, l]) => (
          <div key={l} className="rounded-lg border hairline bg-paper/60 px-3 py-2">
            <p className="font-display text-2xl font-semibold text-ink num">{v}</p>
            <p className="text-xs text-ink-muted">{l}</p>
          </div>
        ))}
      </div>
      <pre className="overflow-hidden rounded-lg border hairline bg-paper-sunken/70 px-3 py-2 font-mono text-[0.72rem] leading-relaxed text-ink-muted">
        <span className="text-ink">J9312   </span> 126 units N450242005121ML125.05{"\n"}
        <span className="text-ink">J9312-JW</span>   4 units N450242005121ML4.95
      </pre>
      <div className="flex items-center gap-2 text-xs text-ink-muted">
        <span className="inline-flex h-2 flex-1 overflow-hidden rounded-full bg-paper-sunken">
          <span className="h-full w-[96%] rounded-full bg-brand" />
        </span>
        2 × 500 mg + 3 × 100 mg · 96% used
      </div>
    </div>
  );
}

function AuditPreview() {
  const rows: [typeof CircleCheck, string, string][] = [
    [CircleCheck, "text-ok", "Pair matches the CMS crosswalk"],
    [CircleX, "text-danger", "Code terminated last quarter"],
    [CircleAlert, "text-accent", "NDC missing from the crosswalk"],
  ];
  return (
    <ul className="mt-4 space-y-1.5">
      {rows.map(([Icon, cls, text]) => (
        <li key={text} className="flex items-center gap-2 rounded-md bg-paper/60 px-2.5 py-1.5 text-xs text-ink-muted">
          <Icon className={`h-3.5 w-3.5 shrink-0 ${cls}`} /> {text}
        </li>
      ))}
    </ul>
  );
}

function MarginPreview() {
  return (
    <div className="mt-4 flex items-end gap-1.5" style={{ height: "3.25rem" }}>
      {[62, 80, 45, 90, 30, 70, 55, 85, 25, 66].map((h, i) => (
        <span key={i} className={`flex-1 rounded-sm ${i === 4 || i === 8 ? "bg-danger/70" : i === 2 ? "bg-accent/70" : "bg-brand/60"}`} style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}

function BiosimilarPreview() {
  return (
    <div className="mt-4 space-y-1.5">
      {[
        ["Reference", "w-full", "bg-ink-faint/50"],
        ["Biosimilar", "w-1/2", "bg-brand/70"],
        ["Biosimilar", "w-1/3", "bg-brand/70"],
      ].map(([l, w, c], i) => (
        <div key={i} className="flex items-center gap-2 text-[0.7rem] text-ink-muted">
          <span className="w-16 shrink-0">{l}</span>
          <span className={`h-2 rounded-full ${w} ${c}`} />
        </div>
      ))}
    </div>
  );
}

function ChangesPreview() {
  return (
    <div className="mt-4 flex flex-wrap gap-1.5 text-xs">
      <span className="inline-flex items-center gap-1 rounded-full bg-ok-tint px-2 py-0.5 font-semibold text-ok">
        <TrendingUp className="h-3.5 w-3.5" /> limit up
      </span>
      <span className="inline-flex items-center gap-1 rounded-full bg-danger-tint px-2 py-0.5 font-semibold text-danger">
        <TrendingDown className="h-3.5 w-3.5" /> limit down
      </span>
      <span className="inline-flex items-center gap-1 rounded-full bg-accent-tint px-2 py-0.5 font-semibold text-ink">
        <Star className="h-3.5 w-3.5 text-accent" /> watchlist
      </span>
      <span className="inline-flex items-center gap-1 rounded-full bg-brand-tint px-2 py-0.5 font-semibold text-ink">
        <Rss className="h-3.5 w-3.5 text-brand" /> RSS
      </span>
    </div>
  );
}

function ScanPreview() {
  return (
    <div className="mt-4 flex items-center gap-3">
      <span className="grid shrink-0 grid-cols-6 gap-px rounded-md border hairline bg-paper/60 p-1.5">
        {"101101011010110011101010010111101001".split("").map((b, i) => (
          <span key={i} className={`h-1.5 w-1.5 ${b === "1" ? "bg-ink" : "bg-transparent"}`} />
        ))}
      </span>
      <span className="font-mono text-[0.72rem] leading-relaxed text-ink-muted">
        NDC 50242-0051-21 → J9312
        <br />
        10 units / pkg · single-dose
      </span>
    </div>
  );
}


const PREVIEW: Record<string, ReactNode> = {
  "/tools/scan": <ScanPreview />,
  "/calculator": <CalculatorPreview />,
  "/tools/audit": <AuditPreview />,
  "/tools/margin": <MarginPreview />,
  "/tools/biosimilars": <BiosimilarPreview />,
  "/tools/changes": <ChangesPreview />,
};

const LAYOUT: Record<string, string> = {
  "/calculator": "md:col-span-2 xl:col-span-1 xl:row-span-2",
  "/tools/audit": "",
  "/tools/margin": "",
  "/tools/biosimilars": "",
  "/tools/changes": "",
  "/tools/site-of-care": "",
  "/tools/price-benchmark": "xl:col-span-2",
  "/tools/intake": "xl:col-span-2",
};

/** The five tools as a bento grid: the calculator large, the director tools around it. */
export function ToolsBento({ headingLevel = 2 }: { headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1.15fr_1fr_1fr]">
      {TOOLS.map((tool) => (
        <li key={tool.href} className={LAYOUT[tool.href]}>
          <Link
            href={tool.href}
            className="group relative flex h-full flex-col overflow-hidden rounded-2xl border hairline bg-surface p-5 transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-brand hover:shadow-card sm:p-6"
          >
            <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_70%_at_100%_0%,var(--brand-tint),transparent_60%)] opacity-70" />
            <span className="relative flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-tint text-brand">
                <tool.icon aria-hidden="true" className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <H className="text-lg leading-snug font-semibold text-ink">{tool.title}</H>
                <span className="block text-[0.7rem] font-semibold tracking-wider text-ink-faint uppercase">{tool.who}</span>
              </span>
              <ArrowUpRight aria-hidden="true" className="h-5 w-5 shrink-0 text-ink-faint transition-colors group-hover:text-brand" />
            </span>
            <span className="relative mt-3 block text-sm leading-relaxed text-ink-muted">{tool.body}</span>
            <span aria-hidden="true" className="relative mt-auto block">
              {PREVIEW[tool.href]}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
