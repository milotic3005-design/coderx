"use client";

import { Calculator, CircleAlert, Info } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { calculateBillingUnits, UNITS, type CalculatorInput, type ContainerType, type UnitKey } from "@/lib/billing";

export interface CalculatorPrefill {
  code?: string | null;
  descriptor?: string | null;
  billingUnitAmount?: number | null;
  billingUnitUnit?: UnitKey | null;
  billingUnitSource?: string | null;
  paymentLimit?: number | null;
  paymentSource?: string | null;
  containerAmount?: number | null;
  containerUnit?: UnitKey | null;
  containerSource?: string | null;
  ndc?: string | null;
}

const UNIT_OPTIONS = Object.values(UNITS);

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function num(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : Number.NaN;
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-ink">
        {label}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="mt-0.5 text-xs text-ink-muted">
          {hint}
        </p>
      ) : null}
      <div className="mt-1.5">{children}</div>
      {error ? (
        <p id={`${id}-error`} className="mt-1 flex items-center gap-1 text-sm font-semibold text-danger">
          <CircleAlert aria-hidden="true" className="h-4 w-4" /> {error}
        </p>
      ) : null}
    </div>
  );
}

const inputCls = "block min-h-11 w-full rounded-lg border border-rule-strong bg-surface-raised px-3 text-base text-ink aria-[invalid=true]:border-danger";

export function BillingCalculator({ prefill }: { prefill: CalculatorPrefill }) {
  const id = useId();
  const [dose, setDose] = useState("");
  const [doseUnit, setDoseUnit] = useState<UnitKey>(prefill.billingUnitUnit ?? "mg");
  const [unitAmount, setUnitAmount] = useState(prefill.billingUnitAmount ? String(prefill.billingUnitAmount) : "");
  const [unitUnit, setUnitUnit] = useState<UnitKey>(prefill.billingUnitUnit ?? "mg");
  const [containerAmount, setContainerAmount] = useState(prefill.containerAmount ? String(prefill.containerAmount) : "");
  const [containerUnit, setContainerUnit] = useState<UnitKey>(prefill.containerUnit ?? prefill.billingUnitUnit ?? "mg");
  const [containersOpened, setContainersOpened] = useState("");
  const [discarded, setDiscarded] = useState("");
  const [containerType, setContainerType] = useState<ContainerType>("unknown");
  const [payment, setPayment] = useState(prefill.paymentLimit != null ? String(prefill.paymentLimit) : "");
  const [touched, setTouched] = useState(false);

  const input: CalculatorInput = useMemo(
    () => ({
      dose: num(dose) ?? Number.NaN,
      doseUnit,
      billingUnitAmount: num(unitAmount) ?? Number.NaN,
      billingUnitUnit: unitUnit,
      containerAmount: num(containerAmount),
      containerUnit,
      containersOpened: num(containersOpened),
      discardedAmount: num(discarded),
      discardedUnit: unitUnit,
      containerType,
      paymentLimitPerUnit: num(payment),
    }),
    [dose, doseUnit, unitAmount, unitUnit, containerAmount, containerUnit, containersOpened, discarded, containerType, payment],
  );

  const ready = dose.trim() !== "" && unitAmount.trim() !== "";
  const result = ready ? calculateBillingUnits(input) : null;
  const errors = result && !result.ok ? Object.fromEntries(result.errors.map((e) => [e.field, e.message])) : {};
  const showErrors = touched || ready;

  const unitSelect = (value: UnitKey, onChange: (u: UnitKey) => void, labelId: string, label: string) => (
    <select aria-labelledby={labelId} aria-label={label} value={value} onChange={(e) => onChange(e.target.value as UnitKey)} className={`${inputCls} w-28 shrink-0`}>
      {UNIT_OPTIONS.map((u) => (
        <option key={u.key} value={u.key}>
          {u.label}
        </option>
      ))}
    </select>
  );

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr]">
      <form
        className="space-y-6 rounded-xl border hairline bg-surface p-5 sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
        }}
        aria-label="Billing unit calculator inputs"
        noValidate
      >
        <fieldset className="space-y-4">
          <legend className="font-display text-xl font-semibold text-ink">1 · HCPCS billing unit</legend>
          {prefill.code ? (
            <p className="rounded-lg bg-paper-sunken px-3 py-2 text-sm text-ink-muted">
              <span className="code-chip font-semibold text-ink">{prefill.code}</span> — {prefill.descriptor}
              {prefill.billingUnitSource ? <span className="mt-1 block text-xs">{prefill.billingUnitSource}</span> : null}
            </p>
          ) : null}
          <Field id={`${id}-unit`} label="One billing unit equals" hint="From the HCPCS descriptor, e.g. “10 mg” for “Injection, rituximab, 10 mg”." error={showErrors ? errors.billingUnitAmount : undefined}>
            <div className="flex gap-2">
              <input
                id={`${id}-unit`}
                inputMode="decimal"
                value={unitAmount}
                onChange={(e) => setUnitAmount(e.target.value)}
                aria-invalid={showErrors && !!errors.billingUnitAmount}
                aria-describedby={`${id}-unit-hint${errors.billingUnitAmount ? ` ${id}-unit-error` : ""}`}
                className={inputCls}
              />
              {unitSelect(unitUnit, setUnitUnit, `${id}-unit`, "Billing unit measure")}
            </div>
          </Field>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="font-display text-xl font-semibold text-ink">2 · Dose administered</legend>
          <Field id={`${id}-dose`} label="Dose" hint="The amount given to the patient for this line." error={showErrors ? (errors.dose ?? errors.doseUnit) : undefined}>
            <div className="flex gap-2">
              <input
                id={`${id}-dose`}
                inputMode="decimal"
                value={dose}
                onChange={(e) => setDose(e.target.value)}
                aria-invalid={showErrors && !!(errors.dose || errors.doseUnit)}
                aria-describedby={`${id}-dose-hint${errors.dose || errors.doseUnit ? ` ${id}-dose-error` : ""}`}
                className={inputCls}
              />
              {unitSelect(doseUnit, setDoseUnit, `${id}-dose`, "Dose unit")}
            </div>
          </Field>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="font-display text-xl font-semibold text-ink">3 · Container (optional)</legend>
          {prefill.containerSource ? <p className="text-xs text-ink-muted">{prefill.containerSource}</p> : null}
          <Field id={`${id}-container`} label="Drug amount per vial or package item" error={showErrors ? (errors.containerAmount ?? errors.containerUnit) : undefined}>
            <div className="flex gap-2">
              <input
                id={`${id}-container`}
                inputMode="decimal"
                value={containerAmount}
                onChange={(e) => setContainerAmount(e.target.value)}
                aria-invalid={showErrors && !!(errors.containerAmount || errors.containerUnit)}
                aria-describedby={errors.containerAmount || errors.containerUnit ? `${id}-container-error` : undefined}
                className={inputCls}
              />
              {unitSelect(containerUnit, setContainerUnit, `${id}-container`, "Container measure")}
            </div>
          </Field>
          <Field id={`${id}-opened`} label="Containers opened" hint="Leave blank to use the minimum needed for the dose." error={showErrors ? errors.containersOpened : undefined}>
            <input
              id={`${id}-opened`}
              inputMode="numeric"
              value={containersOpened}
              onChange={(e) => setContainersOpened(e.target.value)}
              aria-invalid={showErrors && !!errors.containersOpened}
              aria-describedby={`${id}-opened-hint${errors.containersOpened ? ` ${id}-opened-error` : ""}`}
              className={inputCls}
            />
          </Field>
          <Field id={`${id}-discarded`} label={`Known discarded amount (${UNITS[unitUnit].label}, optional)`} hint="Overrides the container-based estimate when you recorded the actual wastage." error={showErrors ? errors.discardedAmount : undefined}>
            <input
              id={`${id}-discarded`}
              inputMode="decimal"
              value={discarded}
              onChange={(e) => setDiscarded(e.target.value)}
              aria-invalid={showErrors && !!errors.discardedAmount}
              aria-describedby={`${id}-discarded-hint${errors.discardedAmount ? ` ${id}-discarded-error` : ""}`}
              className={inputCls}
            />
          </Field>
          <div role="radiogroup" aria-labelledby={`${id}-ctype`}>
            <p id={`${id}-ctype`} className="text-sm font-semibold text-ink">
              Container type
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(
                [
                  ["single-dose", "Single-dose"],
                  ["multi-dose", "Multi-dose"],
                  ["unknown", "Not sure"],
                ] as const
              ).map(([v, l]) => (
                <label key={v} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm ${containerType === v ? "border-brand bg-brand-tint" : "border-rule-strong"}`}>
                  <input type="radio" name={`${id}-ctype`} value={v} checked={containerType === v} onChange={() => setContainerType(v)} className="h-4 w-4 accent-[var(--brand)]" />
                  {l}
                </label>
              ))}
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="font-display text-xl font-semibold text-ink">4 · Payment limit (optional)</legend>
          <Field id={`${id}-pay`} label="Medicare payment limit per billing unit ($)" hint={prefill.paymentSource ?? "Leave blank to skip the derived dollar estimate."}>
            <input id={`${id}-pay`} inputMode="decimal" value={payment} onChange={(e) => setPayment(e.target.value)} aria-describedby={`${id}-pay-hint`} className={inputCls} />
          </Field>
        </fieldset>

        <button type="submit" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand px-5 font-semibold text-paper hover:bg-brand-strong dark:text-paper-sunken">
          <Calculator aria-hidden="true" className="h-4 w-4" /> Calculate
        </button>
      </form>

      <section aria-labelledby={`${id}-result-title`} aria-live="polite" className="space-y-5">
        <h2 id={`${id}-result-title`} className="font-display text-2xl font-semibold text-ink">
          Result
        </h2>
        {!result ? (
          <p className="rounded-xl border border-dashed border-rule-strong bg-surface p-6 text-sm text-ink-muted">Enter the billing unit and the dose to see HCPCS units, the formula, and any discarded quantity.</p>
        ) : !result.ok ? (
          <p className="rounded-xl border border-danger/40 bg-danger-tint/50 p-5 text-sm text-ink" role="alert">
            {result.errors.map((e) => e.message).join(" ")}
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border hairline bg-surface p-5">
                <p className="text-xs font-semibold tracking-wide text-ink-faint uppercase">Administered HCPCS units</p>
                <p className="mt-1 font-display text-5xl font-semibold text-ink num">{result.administeredUnits}</p>
                <p className="mt-1 text-sm text-ink-muted">
                  {result.rawUnits} before rounding{prefill.code ? ` · ${prefill.code}` : ""}
                </p>
              </div>
              <div className="rounded-xl border hairline bg-surface p-5">
                <p className="text-xs font-semibold tracking-wide text-ink-faint uppercase">Units attributable to discarded drug</p>
                <p className="mt-1 font-display text-5xl font-semibold text-ink num">{result.discardedUnits ?? "—"}</p>
                <p className="mt-1 text-sm text-ink-muted">
                  {result.discardedAmount != null ? `${result.discardedAmount} ${result.unitLabel} unused` : "Add container details to calculate"}
                </p>
              </div>
            </div>
            {result.utilizationPct != null ? (
              <div className="rounded-xl border hairline bg-surface p-5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold text-ink">Full-vial utilization</span>
                  <span className="code-chip text-ink">{result.utilizationPct}%</span>
                </div>
                <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-paper-sunken" aria-hidden="true">
                  <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, result.utilizationPct)}%` }} />
                </div>
                <p className="mt-2 text-xs text-ink-muted">
                  {result.containersOpened != null ? `${result.containersOpened} container(s) opened · ` : ""}
                  {result.totalOpened} {result.unitLabel} opened · {result.discardedAmount} {result.unitLabel} remaining
                </p>
              </div>
            ) : null}
            {result.estimatedAllowedAdministered != null ? (
              <div className="rounded-xl border border-dashed border-rule-strong bg-surface p-5 text-sm">
                <p className="text-xs font-semibold tracking-wide text-ink-faint uppercase">Derived calculation — not a payment determination</p>
                <p className="mt-1 text-ink">
                  Administered: <span className="code-chip font-semibold">{usd(result.estimatedAllowedAdministered)}</span>
                  {result.estimatedAllowedDiscarded != null ? (
                    <>
                      {" "}
                      · Discarded units: <span className="code-chip font-semibold">{usd(result.estimatedAllowedDiscarded)}</span>
                    </>
                  ) : null}
                </p>
                <p className="mt-1 text-xs text-ink-muted">Units × payment limit, before deductible, coinsurance, sequestration, and payer-specific rules.</p>
              </div>
            ) : null}

            <div>
              <h3 className="mb-2 text-sm font-semibold text-ink">Formula</h3>
              <ol className="divide-y divide-rule rounded-xl border hairline bg-surface">
                {result.steps.map((s, i) => (
                  <li key={`${s.label}-${i}`} className="grid gap-1 px-4 py-2.5 text-sm sm:grid-cols-[1.2fr_1fr_auto] sm:items-center sm:gap-4">
                    <span className="text-ink-muted">{s.label}</span>
                    <span className="code-chip text-ink-faint">{s.expression}</span>
                    <span className="code-chip font-semibold text-ink sm:text-right">{s.value}</span>
                  </li>
                ))}
              </ol>
            </div>

            {result.warnings.length ? (
              <ul className="space-y-2">
                {result.warnings.map((w) => (
                  <li key={w} className="flex gap-2 rounded-lg border border-accent/40 bg-accent-tint/50 px-4 py-3 text-sm text-ink">
                    <CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                    {w}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}

        <div className="space-y-3 rounded-xl border hairline bg-surface p-5 text-sm text-ink-muted">
          <p className="flex gap-2 font-semibold text-ink">
            <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
            Verify before billing
          </p>
          <p>
            Payer rules and claim requirements must be verified. This calculator applies arithmetic conventions described in Medicare instructions — whole units, rounded up when a dose is not a multiple of the descriptor — and other payers may differ.
          </p>
          <p>
            <span className="font-semibold text-ink">About discarded-drug modifiers (educational):</span> for separately payable Part B drugs from single-dose containers, Medicare instructions describe reporting discarded amounts on a separate line with the JW modifier and using the JZ modifier when nothing was discarded. CodeRx does not determine whether a modifier applies to your claim. Check the current{" "}
            <a href="https://www.cms.gov/medicare/payment/part-b-drugs/discarded-drugs" rel="noopener noreferrer">
              CMS discarded drugs guidance
            </a>
            , your MAC, and the payer.
          </p>
        </div>
      </section>
    </div>
  );
}
