/**
 * Expected Medicare Part B revenue for a drug versus the user's own acquisition cost.
 * The CMS payment limit is the allowed amount per billing unit. The patient owes the
 * coinsurance share published in the CMS file (20%, or less for drugs with an
 * inflation-adjusted coinsurance); sequestration reduces only Medicare's share.
 * Derived arithmetic for orientation, not a payment determination.
 */

export interface MarginOptions {
  /** Sequestration reduction applied to the Medicare program payment, in percent (2 by default). */
  sequestrationPct: number;
  /** Count the patient coinsurance as collected revenue. */
  includeCoinsurance: boolean;
}

export const DEFAULT_MARGIN_OPTIONS: MarginOptions = { sequestrationPct: 2, includeCoinsurance: true };

export interface MarginResult {
  /** Allowed amount for the quantity (payment limit × units). */
  allowed: number;
  patientShare: number;
  programShare: number;
  /** Expected revenue after sequestration (patient share included only when collected). */
  expected: number;
  cost: number;
  margin: number;
  /** Margin as a percent of expected revenue. */
  marginPct: number | null;
  status: "underwater" | "thin" | "positive";
}

const r2 = (x: number) => Math.round(x * 100) / 100;

export function medicareMargin(input: { paymentLimit: number; units: number; coinsurancePct: number | null; cost: number }, options: MarginOptions = DEFAULT_MARGIN_OPTIONS): MarginResult {
  const coins = (input.coinsurancePct ?? 20) / 100;
  const allowed = input.paymentLimit * input.units;
  const patientShare = allowed * coins;
  const programShare = allowed * (1 - coins) * (1 - options.sequestrationPct / 100);
  const expected = programShare + (options.includeCoinsurance ? patientShare : 0);
  const margin = expected - input.cost;
  const marginPct = expected > 0 ? Math.round((margin / expected) * 1000) / 10 : null;
  return {
    allowed: r2(allowed),
    patientShare: r2(patientShare),
    programShare: r2(programShare),
    expected: r2(expected),
    cost: r2(input.cost),
    margin: r2(margin),
    marginPct,
    status: margin < 0 ? "underwater" : marginPct != null && marginPct < 5 ? "thin" : "positive",
  };
}
