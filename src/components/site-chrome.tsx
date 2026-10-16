import { Menu } from "lucide-react";
import Link from "next/link";
import { NAV, SITE } from "@/lib/site";
import { ThemeToggle } from "./client-bits";
import { HeaderSearch } from "./header-search";
import { Wordmark } from "./logo";

export function SiteHeader() {
  return (
    <header data-site-header className="sticky top-0 z-30 border-b hairline bg-paper/85 backdrop-blur supports-[backdrop-filter]:bg-paper/75">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="shrink-0 rounded-lg" aria-label={`${SITE.name} home`}>
          <Wordmark />
        </Link>
        <nav aria-label="Primary" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-semibold text-ink-muted transition-colors hover:bg-surface hover:text-ink">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2">
          <HeaderSearch />
          <ThemeToggle />
          <details className="relative lg:hidden">
            <summary className="inline-flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-lg text-ink-muted hover:bg-surface hover:text-ink [&::-webkit-details-marker]:hidden">
              <Menu aria-hidden="true" className="h-5 w-5" />
              <span className="sr-only">Open menu</span>
            </summary>
            <nav aria-label="Mobile" className="absolute right-0 mt-2 w-64 rounded-xl border hairline bg-surface-raised p-2 shadow-card">
              <ul>
                {NAV.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} className="flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-ink hover:bg-paper-sunken">
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer data-site-footer className="mt-16 border-t hairline bg-paper-sunken/50">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr] lg:px-8">
        <div className="max-w-md">
          <Wordmark />
          <p className="mt-3 text-sm text-ink-muted">{SITE.tagline}</p>
          <p className="mt-4 text-xs leading-relaxed text-ink-faint">
            Built on public CMS and FDA data. Not affiliated with or endorsed by CMS, FDA, Medicare, or any payer. CPT® is a registered trademark of the
            American Medical Association; CPT content is not included.
          </p>
        </div>
        <nav aria-label="Reference">
          <h2 className="text-xs font-semibold tracking-wider text-ink-faint uppercase">Reference</h2>
          <ul className="mt-3 space-y-1 text-sm">
            <li><Link className="inline-flex min-h-9 items-center text-ink-muted hover:text-ink hover:underline" href="/methodology">Methodology</Link></li>
            <li><Link className="inline-flex min-h-9 items-center text-ink-muted hover:text-ink hover:underline" href="/sources">Data sources &amp; releases</Link></li>
            <li><Link className="inline-flex min-h-9 items-center text-ink-muted hover:text-ink hover:underline" href="/codes">Browse code families</Link></li>
            <li><Link className="inline-flex min-h-9 items-center text-ink-muted hover:text-ink hover:underline" href="/calculator">Billing-unit calculator</Link></li>
            <li><Link className="inline-flex min-h-9 items-center text-ink-muted hover:text-ink hover:underline" href="/tools">All tools</Link></li>
            <li><a className="inline-flex min-h-9 items-center text-ink-muted hover:text-ink hover:underline" href="/api/health">API status</a></li>
          </ul>
        </nav>
        <nav aria-label="Legal">
          <h2 className="text-xs font-semibold tracking-wider text-ink-faint uppercase">Legal</h2>
          <ul className="mt-3 space-y-1 text-sm">
            <li><Link className="inline-flex min-h-9 items-center text-ink-muted hover:text-ink hover:underline" href="/privacy">Privacy</Link></li>
            <li><Link className="inline-flex min-h-9 items-center text-ink-muted hover:text-ink hover:underline" href="/terms">Terms of use</Link></li>
            <li><Link className="inline-flex min-h-9 items-center text-ink-muted hover:text-ink hover:underline" href="/methodology#limitations">Limitations</Link></li>
          </ul>
        </nav>
      </div>
      <div className="border-t hairline">
        <p className="mx-auto max-w-7xl px-4 py-5 text-xs leading-relaxed text-ink-faint sm:px-6 lg:px-8">{SITE.disclaimer}</p>
      </div>
    </footer>
  );
}
