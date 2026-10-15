"use client";

import { RotateCcw } from "lucide-react";
import Link from "next/link";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-2xl py-16 text-center" role="alert">
      <h1 className="font-display text-4xl font-semibold tracking-tight text-ink">Something went wrong</h1>
      <p className="mt-3 text-ink-muted">The data service did not respond as expected. Your search was not saved. Please try again.</p>
      <div className="mt-8 flex justify-center gap-3">
        <button type="button" onClick={() => reset()} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand px-4 font-semibold text-paper hover:bg-brand-strong dark:text-paper-sunken">
          <RotateCcw aria-hidden="true" className="h-4 w-4" /> Try again
        </button>
        <Link href="/" className="inline-flex min-h-11 items-center rounded-lg border border-rule-strong px-4 font-semibold text-ink hover:border-brand">
          Home
        </Link>
      </div>
    </div>
  );
}
