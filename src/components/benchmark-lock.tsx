import { LockKeyhole, Unlock } from "lucide-react";

/** Password form for the MultiCare price benchmark; posts to /api/benchmark-access and returns to `next`. */
export function BenchmarkUnlockForm({ next, denied = false, compact = false }: { next: string; denied?: boolean; compact?: boolean }) {
  return (
    <form action="/api/benchmark-access" method="post" className={`rounded-xl border hairline bg-surface ${compact ? "p-4" : "p-5 sm:p-6"}`} aria-label="Unlock the MultiCare price benchmark">
      <p className="flex items-center gap-2 font-semibold text-ink">
        <LockKeyhole aria-hidden="true" className="h-4 w-4 text-brand" /> MultiCare negotiated rates are password protected
      </p>
      {compact ? null : <p className="mt-1 text-sm text-ink-muted">Enter the benchmark password to see rates from MultiCare&apos;s hospital price transparency files.</p>}
      <input type="hidden" name="next" value={next} />
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-sm font-semibold text-ink">
          Password
          <input type="password" name="password" required autoComplete="current-password" className="mt-1 block min-h-11 w-48 rounded-lg border border-rule-strong bg-surface-raised px-3 text-base text-ink" />
        </label>
        <button type="submit" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand px-4 font-semibold text-paper hover:bg-brand-strong dark:text-paper-sunken">
          <Unlock aria-hidden="true" className="h-4 w-4" /> Unlock
        </button>
      </div>
      {denied ? (
        <p role="alert" className="mt-2 text-sm font-semibold text-danger">
          That password is not correct.
        </p>
      ) : null}
    </form>
  );
}

/** Clears the benchmark cookie on this browser. */
export function BenchmarkLockButton({ next }: { next: string }) {
  return (
    <form action="/api/benchmark-access" method="post" className="inline">
      <input type="hidden" name="action" value="lock" />
      <input type="hidden" name="next" value={next} />
      <button type="submit" className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-rule-strong px-3 text-sm font-semibold text-ink hover:border-brand hover:text-brand">
        <LockKeyhole aria-hidden="true" className="h-4 w-4" /> Lock
      </button>
    </form>
  );
}
