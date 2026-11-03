export interface Icd10Row {
  code: string;
  group: number | null;
  description: string | null;
  asterisk: boolean;
}

/** Covered ICD-10-CM codes grouped as the article groups them, in the article's order. */
export function Icd10Groups({ rows, label }: { rows: Icd10Row[]; label: string }) {
  const groups = new Map<number | null, Icd10Row[]>();
  for (const r of rows) groups.set(r.group, [...(groups.get(r.group) ?? []), r]);
  const many = groups.size > 1;
  return (
    <div className="space-y-4">
      {[...groups].map(([group, codes]) => (
        <section key={String(group)} aria-label={`${label}${many && group != null ? `, group ${group}` : ""}`}>
          {many && group != null ? (
            <h4 className="mb-1.5 text-xs font-semibold tracking-wide text-ink-faint uppercase">
              Group {group} · {codes.length} code{codes.length === 1 ? "" : "s"}
            </h4>
          ) : null}
          <ul className="grid gap-x-6 gap-y-1 text-sm md:grid-cols-2">
            {codes.map((c) => (
              <li key={`${group}-${c.code}`} className="flex gap-2">
                <span className="code-chip w-20 shrink-0 font-semibold text-ink">
                  {c.code}
                  {c.asterisk ? (
                    <span className="text-accent" title="Additional coding requirements apply; see the article">
                      *
                    </span>
                  ) : null}
                </span>
                <span className="text-ink-muted">{c.description ?? "—"}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {rows.some((r) => r.asterisk) ? <p className="text-xs text-ink-muted">* The article sets additional coding requirements for these codes (for example, a second diagnosis). Read them on the CMS article.</p> : null}
    </div>
  );
}
