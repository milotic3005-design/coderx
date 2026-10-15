/** CodeRx mark: a label tab carrying an Rx glyph and NDC-style barcode ticks. */
export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="36" height="36" rx="9" fill="var(--brand)" />
      <path d="M2 27h36v2.5a8.5 8.5 0 0 1-8.5 8.5h-19A8.5 8.5 0 0 1 2 29.5z" fill="var(--brand-strong)" />
      <g fill="var(--paper)">
        <path d="M11 9.5h7.2c3.3 0 5.5 2 5.5 4.9 0 2.3-1.4 4-3.6 4.6l3.2 4.4h-3.5l-2.9-4.1h-3v4.1H11zm3 2.6v4.6h3.9c1.6 0 2.6-.9 2.6-2.3s-1-2.3-2.6-2.3z" />
        <path d="m21.8 19.2 2.3-.1 2 2.9 2.1-2.9h2.6l-3.4 4.6 3.5 4.7h-2.7l-2.1-3-2.1 3h-2.6l3.4-4.7z" opacity=".92" />
        <rect x="8" y="30" width="1.4" height="5" rx=".4" />
        <rect x="11" y="30" width=".8" height="5" rx=".4" />
        <rect x="13.4" y="30" width="2" height="5" rx=".4" />
        <rect x="17" y="30" width=".8" height="5" rx=".4" />
        <rect x="19.4" y="30" width="1.4" height="5" rx=".4" />
        <rect x="22.4" y="30" width=".8" height="5" rx=".4" />
        <rect x="24.8" y="30" width="2" height="5" rx=".4" />
        <rect x="28.4" y="30" width=".8" height="5" rx=".4" />
        <rect x="30.8" y="30" width="1.4" height="5" rx=".4" />
      </g>
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark />
      <span className="font-display text-[1.45rem] leading-none font-semibold tracking-tight text-ink">
        Code<span className="text-brand italic">Rx</span>
      </span>
    </span>
  );
}
