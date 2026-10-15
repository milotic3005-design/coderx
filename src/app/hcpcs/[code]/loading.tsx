export default function Loading() {
  return (
    <div className="py-8" role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="skeleton h-4 w-48 rounded" />
      <div className="skeleton mt-4 h-12 w-3/4 max-w-2xl rounded-lg" />
      <div className="skeleton mt-3 h-5 w-1/2 max-w-xl rounded" />
      <div className="mt-10 grid gap-8 lg:grid-cols-[13rem_1fr]">
        <div className="hidden space-y-2 lg:block">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="skeleton h-8 rounded-md" />
          ))}
        </div>
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-28 rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
