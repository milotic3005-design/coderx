import type { Metadata } from "next";
import Link from "next/link";
import { BillingCalculator, type CalculatorPackage, type CalculatorPrefill } from "@/components/billing-calculator";
import { Callout, Disclaimer, PageHeader } from "@/components/layout-bits";
import { cachedHcpcsDetail } from "@/lib/data/cached";
import { formatPeriod } from "@/lib/format";
import { normalizeHcpcs } from "@/lib/hcpcs";
import { parseNdc } from "@/lib/ndc";
import { readPackageDescription } from "@/lib/package-label";

export const metadata: Metadata = {
  title: "Billing-unit calculator",
  description: "Convert a drug dose to HCPCS billing units with the formula, rounding, vial utilization, and discarded quantity shown.",
  alternates: { canonical: "/calculator" },
};

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function CalculatorPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const codeParam = typeof sp.code === "string" ? sp.code : undefined;
  const ndcParam = typeof sp.ndc === "string" ? sp.ndc : undefined;
  const code = codeParam ? normalizeHcpcs(codeParam) : null;
  const prefill: CalculatorPrefill = {};
  const notices: string[] = [];

  if (codeParam && !code) notices.push(`“${codeParam.slice(0, 20)}” is not a HCPCS Level II code, so nothing was prefilled.`);
  if (code) {
    const d = await cachedHcpcsDetail(code);
    if (!d) notices.push(`${code} is not in the imported CMS HCPCS files.`);
    else {
      prefill.code = code;
      prefill.descriptor = d.code.longDescription;
      const unit = d.billingUnit;
      if (unit.parsed) {
        prefill.billingUnitAmount = unit.parsed.amount;
        prefill.billingUnitUnit = unit.parsed.unit;
        prefill.billingUnitSource =
          unit.source === "cms_payment_limits"
            ? `Billing unit “${unit.text}” from the CMS payment limit file (${formatPeriod(unit.period)}) — official.`
            : `Billing unit read from the descriptor text — derived; confirm against the descriptor.`;
      } else {
        notices.push(`The billing unit for ${code} (“${unit.text ?? d.code.longDescription}”) is not a simple amount, so enter it manually.`);
      }
      prefill.mue = d.mue;
      prefill.mueSource = d.mueReleases.find((r) => d.mue.some((m) => m.releaseId === r.releaseId)) ?? null;
      if (unit.parsed) {
        const parsedUnit = unit.parsed;
        prefill.packages = d.crosswalk
          .filter((x) => x.isCurrent && x.ndc11 && x.billUnitsPerItem && Number(x.billUnitsPerItem) > 0)
          .map((x): CalculatorPackage => {
            const facts = readPackageDescription(x.fda?.packageDescription);
            return {
              ndc11: x.ndc11!,
              ndcFormatted: x.ndcFormatted,
              labeler: x.labelerName,
              drugName: x.drugName,
              amountPerItem: Math.round(Number(x.billUnitsPerItem) * parsedUnit.amount * 1e6) / 1e6,
              unit: parsedUnit.unit,
              billUnitsPerItem: Number(x.billUnitsPerItem),
              packageDescription: x.fda?.packageDescription ?? null,
              fdaListed: !!x.fda && x.fda.listingStatus === "listed" && (!x.fda.marketingEnd || x.fda.marketingEnd >= new Date().toISOString().slice(0, 10)),
              mlPerItem: facts.mlPerItem,
              containerType: facts.containerType,
              isPowder: facts.isPowder,
            };
          })
          .sort((a, b) => Number(b.fdaListed) - Number(a.fdaListed) || a.amountPerItem - b.amountPerItem || (a.labeler ?? "").localeCompare(b.labeler ?? ""));
        prefill.packageSource = d.releases.crosswalk;
      }
      const p = d.payments[0];
      if (p && p.paymentLimit !== null && p.period === d.latestPaymentPeriod) {
        prefill.paymentLimit = Number(p.paymentLimit);
        prefill.paymentSource = `CMS Part B payment limit ${formatPeriod(p.period)} (per ${p.dosageDescriptor ?? "unit"}). Edit or clear as needed.`;
      }
      if (ndcParam) {
        const parsed = parseNdc(ndcParam);
        const row = parsed.kind === "package" ? d.crosswalk.find((x) => x.ndc11 === parsed.ndc11 && x.isCurrent) ?? d.crosswalk.find((x) => x.ndc11 === parsed.ndc11) : undefined;
        if (row && row.billUnitsPerItem && unit.parsed) {
          const amount = Number(row.billUnitsPerItem) * unit.parsed.amount;
          prefill.containerAmount = Math.round(amount * 1e6) / 1e6;
          prefill.containerUnit = unit.parsed.unit;
          prefill.ndc = row.ndcFormatted;
          prefill.ndc11 = row.ndc11;
          prefill.containerSource = `Derived from the CMS crosswalk for NDC ${row.ndcFormatted}: ${row.billUnitsPerItem} billable units per item × ${unit.text} = ${prefill.containerAmount} ${unit.parsed.unit} per item. Confirm against the package labeling.`;
        } else if (parsed.kind === "package") {
          notices.push(`No CMS crosswalk row links NDC ${ndcParam} to ${code}, so the container amount was not prefilled.`);
        }
      }
    }
  }

  return (
    <>
      <PageHeader
        title="Billing-unit calculator"
        subtitle="Convert an administered dose to HCPCS billing units and see the arithmetic: rounding, vial utilization, and the quantity left over from single-dose containers."
      />
      <form action="/calculator" method="get" className="mb-6 flex max-w-xl flex-wrap items-end gap-2" aria-label="Load a HCPCS code">
        <label className="flex-1">
          <span className="text-sm font-semibold text-ink">Prefill from a HCPCS code</span>
          <input name="code" defaultValue={code ?? ""} placeholder="e.g. J9312" className="mt-1 block min-h-11 w-full rounded-lg border border-rule-strong bg-surface-raised px-3 code-chip text-ink" maxLength={5} />
        </label>
        <button type="submit" className="inline-flex min-h-11 items-center rounded-lg border border-rule-strong bg-surface px-4 font-semibold text-ink hover:border-brand">
          Load
        </button>
        {code ? (
          <Link href={`/hcpcs/${code}`} className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-brand hover:underline">
            View {code}
          </Link>
        ) : null}
      </form>
      {notices.length ? (
        <div className="mb-6 space-y-2">
          {notices.map((n) => (
            <Callout key={n} tone="warning">
              {n}
            </Callout>
          ))}
        </div>
      ) : null}
      <BillingCalculator key={`${code ?? ""}-${ndcParam ?? ""}`} prefill={prefill} />
      <div className="mt-10">
        <Disclaimer />
      </div>
    </>
  );
}
