"use client";

import { Printer } from "lucide-react";

export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-rule-strong bg-surface px-4 font-semibold text-ink hover:border-brand hover:text-brand print:hidden"
    >
      <Printer aria-hidden="true" className="h-4 w-4" /> {label}
    </button>
  );
}
