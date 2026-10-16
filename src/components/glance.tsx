import Link from "next/link";
import type { ReactNode } from "react";

export interface GlanceItem {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "attention";
}

export interface GlanceAction {
  href: string;
  label: string;
  icon?: ReactNode;
  primary?: boolean;
}

/**
 * The key numbers of a record in one row, directly under the page title — the
 * answers most visitors came for, before the detailed sections.
 */
export function GlanceStrip({ id = "at-a-glance", items, actions = [] }: { id?: string; items: GlanceItem[]; actions?: GlanceAction[] }) {
  const cols = { 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5" }[Math.min(5, Math.max(2, items.length)) as 2 | 3 | 4 | 5];
  return (
    <section id={id} aria-label="At a glance" className="mb-8 overflow-hidden rounded-xl border hairline bg-surface shadow-card">
      <dl className={`grid grid-cols-2 ${cols}`}>
        {items.map((it, i) => (
          <div
            key={it.label}
            className={`min-w-0 hairline p-4 sm:p-5 ${i % 2 === 1 ? "border-l" : ""} ${i >= 2 ? "border-t lg:border-t-0" : ""} ${i > 0 ? "lg:border-l" : ""} ${items.length % 2 === 1 && i === items.length - 1 ? "col-span-2 lg:col-span-1" : ""}`}
          >
            <dt className="text-[0.7rem] font-semibold tracking-wider text-ink-faint uppercase">{it.label}</dt>
            <dd className={`mt-1 font-display text-xl leading-tight font-semibold break-words sm:text-2xl [&_.code-chip]:whitespace-nowrap ${it.tone === "attention" ? "text-accent" : "text-ink"}`}>{it.value}</dd>
            {it.hint ? <dd className="mt-1 text-xs text-ink-muted">{it.hint}</dd> : null}
          </div>
        ))}
      </dl>
      {actions.length ? (
        <div className="flex flex-wrap gap-2 border-t hairline bg-paper-sunken/40 px-4 py-3 sm:px-5">
          {actions.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className={
                a.primary
                  ? "inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand px-3.5 text-sm font-semibold text-paper hover:bg-brand-strong dark:text-paper-sunken"
                  : "inline-flex min-h-10 items-center gap-2 rounded-lg border border-rule-strong bg-surface px-3.5 text-sm font-semibold text-ink hover:border-brand hover:text-brand"
              }
            >
              {a.icon}
              {a.label}
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}
