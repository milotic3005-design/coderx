"use client";

import { ArrowUp } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * A compact bar that slides in under the site header once the record's
 * at-a-glance strip has scrolled away, keeping the code and its key numbers in view.
 */
export function StickyRecordBar({
  watchId = "at-a-glance",
  title,
  subtitle,
  facts = [],
  action,
}: {
  watchId?: string;
  title: string;
  subtitle?: string | null;
  facts?: { label: string; value: string }[];
  action?: { href: string; label: string };
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = document.getElementById(watchId);
    if (!el || typeof IntersectionObserver === "undefined") return;
    // Visible once the strip has left the viewport through the top (below the 64px site header).
    const io = new IntersectionObserver(([entry]) => setVisible(!entry.isIntersecting && entry.boundingClientRect.top < 64), { rootMargin: "-64px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [watchId]);

  return (
    <div
      role="region"
      aria-label={`${title} summary`}
      aria-hidden={!visible}
      inert={!visible}
      data-sticky-record-bar
      className={`fixed inset-x-0 top-16 z-20 border-b hairline bg-paper/90 shadow-card backdrop-blur transition-[opacity,transform] duration-200 supports-[backdrop-filter]:bg-paper/80 print:hidden ${
        visible ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-2 opacity-0"
      }`}
    >
      <div className="mx-auto flex h-12 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        <span className="code-chip shrink-0 font-semibold text-ink">{title}</span>
        {subtitle ? <span className="hidden min-w-0 truncate text-sm text-ink-muted sm:block">{subtitle}</span> : null}
        <dl className="ml-auto hidden shrink-0 items-center gap-4 md:flex">
          {facts.map((f) => (
            <div key={f.label} className="flex items-baseline gap-1.5 text-sm">
              <dt className="text-xs text-ink-faint">{f.label}</dt>
              <dd className="code-chip font-semibold text-ink">{f.value}</dd>
            </div>
          ))}
        </dl>
        {action ? (
          <Link href={action.href} className="ml-auto inline-flex min-h-9 shrink-0 items-center rounded-lg bg-brand px-3 text-sm font-semibold text-paper hover:bg-brand-strong md:ml-0 dark:text-paper-sunken">
            {action.label}
          </Link>
        ) : null}
        <a href="#main" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-surface hover:text-ink" aria-label="Back to top">
          <ArrowUp aria-hidden="true" className="h-4 w-4" />
        </a>
      </div>
    </div>
  );
}
