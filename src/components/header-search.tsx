"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { SearchCombobox } from "./search-combobox";

function Inner() {
  const pathname = usePathname();
  const params = useSearchParams();
  // The home and search pages have their own prominent search field.
  if (pathname === "/" || pathname === "/search") return null;
  return (
    <div className="hidden w-full max-w-md md:block">
      <SearchCombobox key={params.get("q") ?? ""} label="Search CodeRx" />
    </div>
  );
}

export function HeaderSearch() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
