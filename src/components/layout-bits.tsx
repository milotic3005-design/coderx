import { Info, SearchX, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { SITE } from "@/lib/site";

/** Numbered document section with an anchor, used on every detail page. */
export function Section({
  id,
  number,
  title,
  description,
  children,
}: {
  id: string;
  number: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-32 border-t hairline pt-8 pb-10 first:border-t-0 first:pt-2">
      <div className="mb-5 flex items-baseline gap-3">
        <span aria-hidden="true" className="code-chip text-sm text-ink-faint">
          {number}
        </span>
        <div>
          <h2 id={`${id}-title`} className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-[1.7rem]">
            {title}
          </h2>
          {description ? <p className="mt-1 max-w-3xl text-sm text-ink-muted">{description}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

/** Sticky "On this page" navigation for long detail pages. */
export function SectionNav({ items }: { items: { id: string; label: string }[] }) {
  return (
    <nav aria-label="On this page" className="min-w-0 text-sm lg:sticky lg:top-32">
      <p className="mb-2 text-xs font-semibold tracking-wider text-ink-faint uppercase">On this page</p>
      <ol className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
        {items.map((item, i) => (
          <li key={item.id} className="shrink-0">
            <a
              href={`#${item.id}`}
              className="flex min-h-9 items-center gap-2 rounded-md px-2.5 py-1.5 whitespace-nowrap text-ink-muted transition-colors hover:bg-surface hover:text-ink"
            >
              <span aria-hidden="true" className="code-chip text-[0.7rem] text-ink-faint">
                {String(i + 1).padStart(2, "0")}
              </span>
              {item.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function KeyValueGrid({ items, columns = 2 }: { items: { label: string; value: ReactNode; mono?: boolean }[]; columns?: 2 | 3 }) {
  return (
    <dl className={`grid gap-x-8 gap-y-4 sm:grid-cols-2 ${columns === 3 ? "lg:grid-cols-3" : ""}`}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0 border-b hairline pb-3">
          <dt className="text-xs font-semibold tracking-wide text-ink-faint uppercase">{it.label}</dt>
          <dd className={`mt-1 text-[0.95rem] break-words text-ink ${it.mono ? "code-chip" : ""}`}>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Horizontally scrollable, keyboard-focusable container for wide tables. */
export function TableScroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className="table-scroll overflow-x-auto rounded-lg border hairline bg-surface">
      {children}
    </div>
  );
}

export const th = "sticky top-0 bg-paper-sunken px-3 py-2.5 text-left text-xs font-semibold tracking-wide whitespace-nowrap text-ink-muted uppercase";
export const td = "border-t hairline px-3 py-2.5 align-top text-sm";

export function NoData({ children }: { children?: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-dashed border-rule-strong bg-paper-sunken/60 px-4 py-3 text-sm text-ink-muted">
      <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children ?? SITE.noData}</span>
    </p>
  );
}

export function Callout({ tone = "info", title, children }: { tone?: "info" | "warning" | "danger"; title?: string; children: ReactNode }) {
  const styles = {
    info: "border-brand/30 bg-brand-tint/50 text-ink",
    warning: "border-accent/40 bg-accent-tint/60 text-ink",
    danger: "border-danger/40 bg-danger-tint/60 text-ink",
  }[tone];
  const Icon = tone === "info" ? Info : TriangleAlert;
  return (
    <div role={tone === "info" ? "note" : "alert"} className={`flex gap-3 rounded-lg border px-4 py-3 text-sm ${styles}`}>
      <Icon aria-hidden="true" className={`mt-0.5 h-4 w-4 shrink-0 ${tone === "info" ? "text-brand" : tone === "warning" ? "text-accent" : "text-danger"}`} />
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className="text-ink-muted [&_a]:font-semibold [&_a]:text-brand [&_a]:underline">{children}</div>
      </div>
    </div>
  );
}

export function Disclaimer({ compact = false }: { compact?: boolean }) {
  return (
    <div role="note" aria-label="Disclaimer" className={`rounded-lg border hairline bg-surface ${compact ? "px-4 py-3 text-xs" : "px-5 py-4 text-sm"} leading-relaxed text-ink-muted`}>
      <p>
        <span className="font-semibold text-ink">Disclaimer. </span>
        {SITE.disclaimer} CodeRx is not affiliated with or endorsed by CMS, FDA, Medicare, or any payer.
      </p>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-rule-strong bg-surface px-6 py-10 text-center">
      <SearchX aria-hidden="true" className="mx-auto h-8 w-8 text-ink-faint" />
      <h2 className="mt-3 font-display text-xl font-semibold text-ink">{title}</h2>
      {children ? <div className="mx-auto mt-2 max-w-xl text-sm text-ink-muted">{children}</div> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function PageHeader({ eyebrow, title, subtitle, badges, actions }: { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; badges?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="ledger -mx-4 mb-6 border-b hairline px-4 pt-8 pb-7 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="mx-auto max-w-7xl">
        {eyebrow ? <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-ink-muted">{eyebrow}</div> : null}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h1 className="font-display text-[2.1rem] leading-[1.08] font-semibold tracking-tight text-ink sm:text-5xl">{title}</h1>
            {subtitle ? <div className="mt-3 max-w-3xl text-base text-ink-muted sm:text-lg">{subtitle}</div> : null}
            {badges ? <div className="mt-4 flex flex-wrap items-center gap-2">{badges}</div> : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
        </div>
      </div>
    </header>
  );
}

export function Breadcrumbs({ items }: { items: { href?: string; label: string }[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-ink-muted">
        {items.map((it, i) => (
          <li key={`${it.label}-${i}`} className="flex items-center gap-1.5">
            {i > 0 ? <span aria-hidden="true">/</span> : null}
            {it.href ? (
              <Link href={it.href} className="hover:text-ink hover:underline">
                {it.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-ink">
                {it.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function ButtonLink({ href, children, variant = "secondary" }: { href: string; children: ReactNode; variant?: "primary" | "secondary" }) {
  const cls =
    variant === "primary"
      ? "bg-brand text-paper hover:bg-brand-strong dark:text-paper-sunken"
      : "border border-rule-strong bg-surface text-ink hover:border-brand hover:text-brand";
  return (
    <Link href={href} className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors ${cls}`}>
      {children}
    </Link>
  );
}
