import Link from "next/link";
import { SearchCombobox } from "@/components/search-combobox";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl py-16 text-center">
      <p className="code-chip text-sm font-semibold text-brand">404</p>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-ink">We couldn’t find that record</h1>
      <p className="mt-3 text-ink-muted">
        The code, NDC, or drug may not be in the CMS and FDA files CodeRx imports, or the link may be mistyped. CPT® codes are not included.
      </p>
      <div className="mt-8 text-left">
        <SearchCombobox size="hero" />
      </div>
      <p className="mt-6 text-sm">
        <Link href="/" className="font-semibold text-brand hover:underline">
          Go to the home page
        </Link>
      </p>
    </div>
  );
}
