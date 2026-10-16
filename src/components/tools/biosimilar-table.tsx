"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { ceilUnits, convert, parseCmsDosage, UNITS } from "@/lib/billing";
import type { ComparatorGroup } from "@/lib/data/tools";
import { TableScroll, td, th } from "../layout-bits";

const usd = (n: number, d = 2) => `$${n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const ROLE = { reference: "Reference product", biosimilar: "Biosimilar", interchangeable: "Interchangeable biosimilar" } as const;

/** One reference biologic and its biosimilars: payment per billing unit and for a dose the user enters. */
export function BiosimilarTable({ group }: { group: ComparatorGroup }) {
  const id = useId();
  const [dose, setDose] = useState("");
  const doseNum = Number(dose);
  const hasDose = dose.trim() !== "" && Number.isFinite(doseNum) && doseNum > 0;

  const rows = group.products.flatMap((p) =>
    p.codes
      .filter((c) => c.payment)
      .map((c) => {
        const unit = parseCmsDosage(c.payment!.dosage);
        const limit = c.payment!.limit != null ? Number(c.payment!.limit) : null;
        const perMeasure = unit && limit != null ? limit / unit.amount : null;
        const doseInUnit = hasDose && unit ? convert(doseNum, "mg", unit.unit) : null;
        const units = doseInUnit != null && unit ? ceilUnits(doseInUnit / unit.amount) : null;
        const allowed = units != null && limit != null ? units * limit : null;
        const coins = c.payment!.coinsurancePct != null ? Number(c.payment!.coinsurancePct) : 20;
        return { product: p, code: c, unit, limit, perMeasure, units, allowed, patient: allowed != null ? (allowed * coins) / 100 : null, coins };
      }),
  );
  const sorted = [...rows].sort((a, b) => (a.perMeasure ?? Infinity) - (b.perMeasure ?? Infinity));
  const reference = rows.find((r) => r.product.role === "reference" && r.perMeasure != null);
  const measure = sorted.find((r) => r.unit)?.unit;
  const measureLabel = measure ? UNITS[measure.unit].label : "unit";
  const doseConvertible = !hasDose || rows.some((r) => r.units != null);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={`${id}-dose`} className="text-sm font-semibold text-ink">
            Dose (mg, optional)
          </label>
          <input
            id={`${id}-dose`}
            value={dose}
            onChange={(e) => setDose(e.target.value)}
            inputMode="decimal"
            autoComplete="off"
            placeholder="e.g. 700"
            className="mt-1 block min-h-11 w-36 rounded-lg border border-rule-strong bg-surface-raised px-3 text-base text-ink placeholder:text-ink-faint"
          />
        </div>
        <p className="pb-2 text-xs text-ink-muted">{hasDose ? "Units are whole billing units, rounded up." : "Enter a dose to compare the Medicare allowed amount and the patient’s coinsurance."}</p>
      </div>
      {!doseConvertible ? <p className="mb-2 text-sm text-accent">These codes are not billed in mass units, so a mg dose cannot be converted.</p> : null}
      <TableScroll label={`${(group.genericName ?? group.referenceName).toLowerCase()} products`}>
        <table className="w-full min-w-[52rem] border-collapse">
          <caption className="sr-only">Payment comparison for {(group.genericName ?? group.referenceName).toLowerCase()}</caption>
          <thead>
            <tr>
              <th scope="col" className={th}>
                Product
              </th>
              <th scope="col" className={th}>
                HCPCS
              </th>
              <th scope="col" className={th}>
                Limit / unit
              </th>
              <th scope="col" className={th}>
                Per {measureLabel}
              </th>
              {hasDose ? (
                <>
                  <th scope="col" className={th}>
                    Units
                  </th>
                  <th scope="col" className={th}>
                    Allowed
                  </th>
                  <th scope="col" className={th}>
                    Patient coinsurance
                  </th>
                </>
              ) : null}
              <th scope="col" className={th}>
                CMS methodology
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={`${r.product.slug}-${r.code.code}`} className={r.product.role === "reference" ? "bg-paper-sunken/50" : ""}>
                <td className={td}>
                  <Link href={`/drugs/${r.product.slug}`} className="font-semibold text-brand hover:underline">
                    {r.product.displayName}
                  </Link>
                  <span className="block text-xs text-ink-muted">{ROLE[r.product.role]}</span>
                </td>
                <td className={td}>
                  <Link href={`/hcpcs/${r.code.code}`} className="code-chip font-semibold whitespace-nowrap text-brand hover:underline">
                    {r.code.code}
                  </Link>
                  {!r.code.isActive ? <span className="block text-xs text-danger">Terminated</span> : null}
                </td>
                <td className={`${td} code-chip`}>
                  {r.limit != null ? usd(r.limit, 3) : "—"}
                  <span className="block font-sans text-xs text-ink-muted">per {r.code.payment!.dosage ?? "unit"}</span>
                </td>
                <td className={`${td} code-chip`}>
                  {r.perMeasure != null ? usd(r.perMeasure, 4) : "—"}
                  {reference && r.perMeasure != null && r !== reference && reference.perMeasure ? (
                    <span className="block font-sans text-xs text-ink-muted">
                      {r.perMeasure <= reference.perMeasure ? "−" : "+"}
                      {Math.abs(Math.round(((r.perMeasure - reference.perMeasure) / reference.perMeasure) * 1000) / 10)}% vs reference
                    </span>
                  ) : null}
                </td>
                {hasDose ? (
                  <>
                    <td className={`${td} code-chip`}>{r.units ?? "—"}</td>
                    <td className={`${td} code-chip`}>{r.allowed != null ? usd(r.allowed) : "—"}</td>
                    <td className={`${td} code-chip`}>
                      {r.patient != null ? usd(r.patient) : "—"}
                      <span className="block font-sans text-xs text-ink-muted">{r.coins}%</span>
                    </td>
                  </>
                ) : null}
                <td className={`${td} text-xs text-ink-muted`}>{r.code.payment!.methodology ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </div>
  );
}
