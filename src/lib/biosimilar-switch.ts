/**
 * Annual effect of moving part of a reference biologic's volume to a biosimilar:
 * Medicare allowed amount, patient coinsurance, expected revenue (Medicare's share net
 * of sequestration plus the patient's share), and — when the user enters costs — margin.
 * Uses payment per mg (CMS payment limit ÷ billing-unit amount), so per-administration
 * rounding to whole billing units is not modeled. Derived arithmetic, not a forecast.
 */

export interface SwitchProduct {
  name: string;
  /** Medicare payment limit per mg. */
  perMg: number;
  /** Patient coinsurance percent from the CMS file (20 unless inflation-adjusted). */
  coinsurancePct: number;
  /** User's acquisition cost per mg (optional). */
  costPerMg?: number | null;
}

export interface SwitchTotals {
  mg: number;
  allowed: number;
  patient: number;
  expected: number;
  cost: number | null;
  margin: number | null;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

function totals(parts: { product: SwitchProduct; mg: number }[], sequestrationPct: number): SwitchTotals {
  let allowed = 0;
  let patient = 0;
  let expected = 0;
  let cost: number | null = 0;
  for (const { product, mg } of parts) {
    const a = mg * product.perMg;
    const c = product.coinsurancePct / 100;
    allowed += a;
    patient += a * c;
    expected += a * c + a * (1 - c) * (1 - sequestrationPct / 100);
    if (mg > 0) cost = cost == null || product.costPerMg == null ? null : cost + mg * product.costPerMg;
  }
  return { mg: parts.reduce((n, p) => n + p.mg, 0), allowed: r2(allowed), patient: r2(patient), expected: r2(expected), cost: cost == null ? null : r2(cost), margin: cost == null ? null : r2(expected - cost) };
}

export function simulateSwitch(input: { annualMg: number; reference: SwitchProduct; target: SwitchProduct; sharePct: number; sequestrationPct?: number }) {
  const seq = input.sequestrationPct ?? 2;
  const share = Math.min(100, Math.max(0, input.sharePct)) / 100;
  const before = totals([{ product: input.reference, mg: input.annualMg }], seq);
  const after = totals(
    [
      { product: input.reference, mg: input.annualMg * (1 - share) },
      { product: input.target, mg: input.annualMg * share },
    ],
    seq,
  );
  const diff = (a: number | null, b: number | null) => (a == null || b == null ? null : r2(b - a));
  return {
    before,
    after,
    delta: { allowed: r2(after.allowed - before.allowed), patient: r2(after.patient - before.patient), expected: r2(after.expected - before.expected), cost: diff(before.cost, after.cost), margin: diff(before.margin, after.margin) },
  };
}
