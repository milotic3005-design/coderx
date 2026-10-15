"use client";

import { Calculator, CircleAlert, Info, RotateCcw } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
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
    <div className="min-w-0">
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
          <CircleAlert aria-hidden="true" className="h-4 w-4 shrink-0" /> {error}
        </p>
      ) : null}
    </div>
  );
}

// One bordered control: the number takes the free width, a unit picker or a fixed label sits at the edge.
const frameCls =
  "flex min-h-12 w-full items-stretch overflow-hidden rounded-lg border border-rule-strong bg-surface-raised focus-within:border-brand focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--focus)] has-[[aria-invalid=true]]:border-danger";
const amountCls =
  "num min-w-0 flex-1 bg-transparent px-3 text-lg font-medium text-ink placeholder:text-base placeholder:font-normal placeholder:text-ink-faint focus-visible:outline-none";
const adornCls = "flex shrink-0 items-center bg-paper-sunken px-3 text-sm font-semibold text-ink-muted";
const selectCls =
  "min-w-[5.5rem] shrink-0 cursor-pointer border-l border-rule bg-paper-sunken px-3 text-base font-semibold text-ink hover:bg-brand-tint focus-visible:bg-brand-tint focus-visible:outline-none";

function AmountInput({
  id,
  value,
  onChange,
  invalid,
  describedBy,
  placeholder,
  numeric = false,
  prefix,
  suffix,
  unit,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  describedBy?: string;
  placeholder?: string;
  numeric?: boolean;
  prefix?: string;
  suffix?: string;
  unit?: { value: UnitKey; onChange: (u: UnitKey) => void; label: string };
}) {
  return (
    <div className={frameCls}>
      {prefix ? (
        <span aria-hidden="true" className={`${adornCls} border-r border-rule`}>
          {prefix}
        </span>
      ) : null}
      <input
        id={id}
        type="text"
        inputMode={numeric ? "numeric" : "decimal"}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="next"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={amountCls}
      />
      {unit ? (
        <select aria-label={unit.label} value={unit.value} onChange={(e) => unit.onChange(e.target.value as UnitKey)} className={selectCls}>
          {UNIT_OPTIONS.map((u) => (
            <option key={u.key} value={u.key}>
              {u.label}
            </option>
          ))}
        </select>
      ) : suffix ? (
        <span aria-hidden="true" className={`${adornCls} border-l border-rule`}>
          {suffix}
        </span>
      ) : null}
    </div>
  );
}

const describe = (...ids: (string | false | undefined)[]) => ids.filter(Boolean).join(" ") || undefined;

export function BillingCalculator({ prefill }: { prefill: CalculatorPrefill }) {
  const id = useId();
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const initialUnit = prefill.billingUnitAmount ? String(prefill.billingUnitAmount) : "";
  const initialContainer = prefill.containerAmount ? String(prefill.containerAmount) : "";
  const initialPayment = prefill.paymentLimit != null ? String(prefill.paymentLimit) : "";
  const [dose, setDose] = useState("");
  const [doseUnit, setDoseUnit] = useState<UnitKey>(prefill.billingUnitUnit ?? "mg");
  const [unitAmount, setUnitAmount] = useState(initialUnit);
  const [unitUnit, setUnitUnit] = useState<UnitKey>(prefill.billingUnitUnit ?? "mg");
  const [containerAmount, setContainerAmount] = useState(initialContainer);
  const [containerUnit, setContainerUnit] = useState<UnitKey>(prefill.containerUnit ?? prefill.billingUnitUnit ?? "mg");
  const [containersOpened, setContainersOpened] = useState("");
  const [discarded, setDiscarded] = useState("");
  const [containerType, setContainerType] = useState<ContainerType>("unknown");
  const [payment, setPayment] = useState(initialPayment);
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
  const err = (...fields: string[]) => (showErrors ? fields.map((f) => errors[f]).find(Boolean) : undefined);

  const reset = () => {
    setDose("");
    setDoseUnit(prefill.billingUnitUnit ?? "mg");
    setUnitAmount(initialUnit);
    setUnitUnit(prefill.billingUnitUnit ?? "mg");
    setContainerAmount(initialContainer);
    setContainerUnit(prefill.containerUnit ?? prefill.billingUnitUnit ?? "mg");
    setContainersOpened("");
    setDiscarded("");
    setContainerType("unknown");
    setPayment(initialPayment);
    setTouched(false);
  };

  const unitErr = err("billingUnitAmount");
  const doseErr = err("dose", "doseUnit");
  const containerErr = err("containerAmount", "containerUnit");
  const openedErr = err("containersOpened");
  const discardedErr = err("discardedAmount");

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <form
        className="min-w-0 space-y-7 rounded-xl border hairline bg-surface p-5 sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          // On one-column layouts the result sits below the form; bring it into view.
          if (window.matchMedia("(max-width: 1023.98px)").matches) {
            const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            resultHeading.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
            resultHeading.current?.focus({ preventScroll: true });
          }
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
          <Field id={`${id}-unit`} label="One billing unit equals" hint="From the HCPCS descriptor, e.g. “10 mg” for “Injection, rituximab, 10 mg”." error={unitErr}>
            <AmountInput
              id={`${id}-unit`}
              value={unitAmount}
              onChange={setUnitAmount}
              placeholder="e.g. 10"
              invalid={!!unitErr}
              describedBy={describe(`${id}-unit-hint`, !!unitErr && `${id}-unit-error`)}
              unit={{ value: unitUnit, onChange: setUnitUnit, label: "Billing unit measure" }}
            />
          </Field>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="font-display text-xl font-semibold text-ink">2 · Dose administered</legend>
          <Field id={`${id}-dose`} label="Dose" hint="The amount given to the patient for this line." error={doseErr}>
            <AmountInput
              id={`${id}-dose`}
              value={dose}
              onChange={setDose}
              placeholder="e.g. 375"
              invalid={!!doseErr}
              describedBy={describe(`${id}-dose-hint`, !!doseErr && `${id}-dose-error`)}
              unit={{ value: doseUnit, onChange: setDoseUnit, label: "Dose unit" }}
            />
          </Field>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="font-display text-xl font-semibold text-ink">3 · Container (optional)</legend>
          {prefill.containerSource ? <p className="text-xs text-ink-muted">{prefill.containerSource}</p> : null}
          <Field id={`${id}-container`} label="Drug amount per vial or package item" error={containerErr}>
            <AmountInput
              id={`${id}-container`}
              value={containerAmount}
              onChange={setContainerAmount}
              placeholder="e.g. 500"
              invalid={!!containerErr}
              describedBy={describe(!!containerErr && `${id}-container-error`)}
              unit={{ value: containerUnit, onChange: setContainerUnit, label: "Container measure" }}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <Field id={`${id}-opened`} label="Containers opened" hint="Blank uses the minimum needed for the dose." error={openedErr}>
              <AmountInput
                id={`${id}-opened`}
                value={containersOpened}
                onChange={setContainersOpened}
                numeric
                placeholder="Minimum"
                invalid={!!openedErr}
                describedBy={describe(`${id}-opened-hint`, !!openedErr && `${id}-opened-error`)}
              />
            </Field>
            <Field id={`${id}-discarded`} label="Known discarded amount" hint="Optional. Overrides the container-based estimate." error={discardedErr}>
              <AmountInput
                id={`${id}-discarded`}
                value={discarded}
                onChange={setDiscarded}
                placeholder="Optional"
                suffix={UNITS[unitUnit].label}
                invalid={!!discardedErr}
                describedBy={describe(`${id}-discarded-hint`, !!discardedErr && `${id}-discarded-error`)}
              />
            </Field>
          </div>
          <div role="radiogroup" aria-labelledby={`${id}-ctype`}>
            <p id={`${id}-ctype`} className="text-sm font-semibold text-ink">
              Container type
            </p>
            <div className="mt-2 grid grid-cols-1 gap-2 min-[420px]:grid-cols-3">
              {(
                [
                  ["single-dose", "Single-dose"],
                  ["multi-dose", "Multi-dose"],
                  ["unknown", "Not sure"],
                ] as const
              ).map(([v, l]) => (
                <label
                  key={v}
                  className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-medium text-ink ${containerType === v ? "border-brand bg-brand-tint" : "border-rule-strong hover:border-brand"}`}
                >
                  <input type="radio" name={`${id}-ctype`} value={v} checked={containerType === v} onChange={() => setContainerType(v)} className="h-4 w-4 shrink-0 accent-[var(--brand)]" />
                  {l}
                </label>
              ))}
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="font-display text-xl font-semibold text-ink">4 · Payment limit (optional)</legend>
          <Field id={`${id}-pay`} label="Medicare payment limit per billing unit" hint={prefill.paymentSource ?? "Leave blank to skip the derived dollar estimate."}>
            <AmountInput id={`${id}-pay`} value={payment} onChange={setPayment} prefix="$" suffix="per unit" placeholder="0.00" describedBy={`${id}-pay-hint`} />
          </Field>
        </fieldset>

        <div className="flex flex-wrap items-center gap-3 border-t hairline pt-5">
          <button type="submit" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand px-5 font-semibold text-paper hover:bg-brand-strong dark:text-paper-sunken">
            <Calculator aria-hidden="true" className="h-4 w-4" /> Calculate
          </button>
          <button type="button" onClick={reset} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-rule-strong px-4 font-semibold text-ink hover:border-brand">
            <RotateCcw aria-hidden="true" className="h-4 w-4" /> Reset
          </button>
          <p className="text-xs text-ink-muted">Results update as you type.</p>
        </div>
      </form>

      <section aria-labelledby={`${id}-result-title`} aria-live="polite" className="min-w-0 space-y-5">
        <h2 id={`${id}-result-title`} ref={resultHeading} tabIndex={-1} className="scroll-mt-24 font-display text-2xl font-semibold text-ink">
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
