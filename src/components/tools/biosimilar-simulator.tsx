"use client";

import { ArrowRightLeft, Lock } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { convert, parseCmsDosage } from "@/lib/billing";
import { simulateSwitch, type SwitchProduct } from "@/lib/biosimilar-switch";
import type { ComparatorGroup } from "@/lib/data/tools";
import { TableScroll, td, th } from "../layout-bits";

const usd = (n: number | null) => (n == null ? "—" : `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`);
const signed = (n: number | null) => (n == null ? "—" : `${n > 0 ? "+" : ""}${usd(n)}`);

interface Option {
  key: string;
  label: string;
  role: "reference" | "biosimilar" | "interchangeable";
  perMg: number;
  coinsurancePct: number;
}

/** Products in a group with a per-mg payment (mass billing units only). */
function options(group: ComparatorGroup): Option[] {
  return group.products.flatMap((p) =>
    p.codes
      .filter((c) => c.payment?.limit != null && c.isActive)
      .map((c) => {
        const unit = parseCmsDosage(c.payment!.dosage);
        const mg = unit ? convert(unit.amount, unit.unit, "mg") : null;
        return mg ? { key: `${p.slug}|${c.code}`, label: `${p.displayName} (${c.code})`, role: p.role, perMg: Number(c.payment!.limit) / mg, coinsurancePct: c.payment!.coinsurancePct != null ? Number(c.payment!.coinsurancePct) : 20 } : null;
      })
      .filter((o): o is Option => !!o),
  );
}

export function BiosimilarSimulator({ groups, initialRef }: { groups: ComparatorGroup[]; initialRef?: string | null }) {
  const id = useId();
  const usable = useMemo(() => groups.filter((g) => options(g).some((o) => o.role === "reference") && options(g).some((o) => o.role !== "reference")), [groups]);
  const [refSlug, setRefSlug] = useState(() => usable.find((g) => g.referenceSlug === initialRef)?.referenceSlug ?? usable[0]?.referenceSlug ?? "");
  const group = usable.find((g) => g.referenceSlug === refSlug);
  const opts = useMemo(() => (group ? options(group) : []), [group]);
  const refOpt = opts.find((o) => o.role === "reference");
  const targets = opts.filter((o) => o.role !== "reference").sort((a, b) => a.perMg - b.perMg);
  const [targetKey, setTargetKey] = useState("");
  const target = targets.find((t) => t.key === targetKey) ?? targets[0];
  const [doses, setDoses] = useState("120");
  const [doseMg, setDoseMg] = useState("700");
  const [share, setShare] = useState("50");
  const [refCost, setRefCost] = useState("");
  const [bioCost, setBioCost] = useState("");

  if (!usable.length) return null;
  const annualMg = Number(doses) * Number(doseMg);
  const valid = refOpt && target && annualMg > 0 && Number.isFinite(annualMg);
  const cost = (v: string) => (v.trim() && Number(v) >= 0 ? Number(v) : null);
  const product = (o: Option, c: string): SwitchProduct => ({ name: o.label, perMg: o.perMg, coinsurancePct: o.coinsurancePct, costPerMg: cost(c) });
  const r = valid ? simulateSwitch({ annualMg, reference: product(refOpt!, refCost), target: product(target!, bioCost), sharePct: Number(share) }) : null;

  const input = "mt-1 block min-h-11 w-full rounded-lg border border-rule-strong bg-surface-raised px-3 text-base text-ink";
  return (
    <section aria-labelledby={`${id}-title`} className="mb-10 rounded-xl border hairline bg-surface p-5 sm:p-6">
      <h2 id={`${id}-title`} className="flex items-center gap-2 font-display text-xl font-semibold text-ink">
        <ArrowRightLeft aria-hidden="true" className="h-5 w-5 text-brand" /> Switch simulator
      </h2>
      <p className="mt-1 text-sm text-ink-muted">Annual effect of moving part of a reference product’s volume to a biosimilar, from the CMS payment limit per mg. Costs you enter stay in this browser.</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm font-semibold text-ink">
          Reference product
          <select value={refSlug} onChange={(e) => (setRefSlug(e.target.value), setTargetKey(""))} className={input}>
            {usable.map((g) => (
              <option key={g.referenceSlug} value={g.referenceSlug}>
                {(g.genericName ?? g.referenceName).toLowerCase()} — {g.referenceName}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold text-ink">
          Switch to
          <select value={target?.key ?? ""} onChange={(e) => setTargetKey(e.target.value)} className={input}>
            {targets.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm font-semibold text-ink">
            Doses / year
            <input value={doses} onChange={(e) => setDoses(e.target.value)} inputMode="numeric" className={input} />
          </label>
          <label className="text-sm font-semibold text-ink">
            mg / dose
            <input value={doseMg} onChange={(e) => setDoseMg(e.target.value)} inputMode="decimal" className={input} />
          </label>
        </div>
        <label className="text-sm font-semibold text-ink">
          Share switched: <span className="code-chip">{share}%</span>
          <input type="range" min={0} max={100} step={5} value={share} onChange={(e) => setShare(e.target.value)} className="mt-3 block w-full accent-[var(--brand)]" />
        </label>
      </div>

      <details className="mt-4">
        <summary className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 text-sm font-semibold text-brand">
          <Lock aria-hidden="true" className="h-3.5 w-3.5" /> Add your acquisition cost per mg (optional)
        </summary>
        <div className="mt-2 grid max-w-lg gap-3 sm:grid-cols-2">
          <label className="text-sm font-semibold text-ink">
            {refOpt?.label ?? "Reference"} $/mg
            <input value={refCost} onChange={(e) => setRefCost(e.target.value)} inputMode="decimal" placeholder="e.g. vial cost ÷ mg" className={input} />
          </label>
          <label className="text-sm font-semibold text-ink">
            {target?.label ?? "Biosimilar"} $/mg
            <input value={bioCost} onChange={(e) => setBioCost(e.target.value)} inputMode="decimal" placeholder="e.g. vial cost ÷ mg" className={input} />
          </label>
        </div>
      </details>

      {r && refOpt && target ? (
        <div className="mt-5" aria-live="polite">
          <TableScroll label="Switch simulation">
            <table className="w-full min-w-[34rem] border-collapse">
              <caption className="sr-only">Annual totals before and after the switch</caption>
              <thead>
                <tr>
                  {["Annual", `All ${refOpt.label.split(" (")[0]}`, `${share}% switched`, "Change"].map((h) => (
                    <th key={h} scope="col" className={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["Medicare allowed", r.before.allowed, r.after.allowed, r.delta.allowed],
                    ["Patient coinsurance (all patients)", r.before.patient, r.after.patient, r.delta.patient],
                    ["Expected revenue (after sequestration)", r.before.expected, r.after.expected, r.delta.expected],
                    ["Your acquisition cost", r.before.cost, r.after.cost, r.delta.cost],
                    ["Margin", r.before.margin, r.after.margin, r.delta.margin],
                  ] as const
                ).map(([label, a, b, d]) => (
                  <tr key={label}>
                    <th scope="row" className={`${td} text-left font-semibold text-ink`}>
                      {label}
                    </th>
                    <td className={`${td} code-chip`}>{usd(a)}</td>
                    <td className={`${td} code-chip`}>{usd(b)}</td>
                    <td className={`${td} code-chip font-semibold ${d == null ? "" : d < 0 ? "text-danger" : d > 0 ? "text-ok" : ""}`}>{signed(d)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          <p className="mt-2 text-xs text-ink-muted">
            {annualMg.toLocaleString()} mg a year · {refOpt.label}: ${refOpt.perMg.toFixed(4)}/mg · {target.label}: ${target.perMg.toFixed(4)}/mg. Per-dose coinsurance changes by{" "}
            {usd(((target.perMg * target.coinsurancePct - refOpt.perMg * refOpt.coinsurancePct) / 100) * Number(doseMg))} for a switched patient. Annual-mg arithmetic: rounding of each dose to whole billing units is not modeled. Switching decisions follow clinical judgment, FDA interchangeability, and state law.
          </p>
        </div>
      ) : (
        <p className="mt-4 text-sm text-ink-muted">Enter doses per year and mg per dose.</p>
      )}
    </section>
  );
}
