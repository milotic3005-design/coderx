/**
 * Vial selection arithmetic for a dose: the least-waste combination of available
 * container sizes, and dose-rounding candidates that use whole containers.
 * All amounts are in the HCPCS billing-unit measure. Decision support only — dose
 * rounding is a clinical decision governed by institutional policy.
 */

export interface VialSize {
  /** Amount of drug in one container, in the billing-unit measure. */
  amount: number;
  label?: string;
}

export interface VialPlan {
  counts: { amount: number; count: number }[];
  total: number;
  waste: number;
  wastePct: number;
  vials: number;
}

const SCALE = 1000; // amounts are compared to 0.001 of the measure
const MAX_STATES = 2_000_000;

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

function round(x: number, d = 4) {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

interface Table {
  step: number;
  units: number[];
  /** Fewest containers to reach each reachable total (index × step); Infinity when unreachable. */
  best: Float64Array;
  /** Size index used last for each total. */
  via: Int16Array;
}

/** Reachable whole-container totals up to `limit`, minimizing container count. */
function reachable(sizes: number[], limit: number): Table | null {
  const scaled = sizes.map((s) => Math.round(s * SCALE)).filter((s) => s > 0);
  if (!scaled.length) return null;
  const step = scaled.reduce(gcd);
  const units = scaled.map((s) => s / step);
  const n = Math.ceil((limit * SCALE) / step);
  if (n > MAX_STATES) return null;
  const best = new Float64Array(n + 1).fill(Infinity);
  const via = new Int16Array(n + 1).fill(-1);
  best[0] = 0;
  for (let t = 1; t <= n; t++) {
    for (let i = 0; i < units.length; i++) {
      const prev = t - units[i];
      if (prev >= 0 && best[prev] + 1 < best[t]) {
        best[t] = best[prev] + 1;
        via[t] = i;
      }
    }
  }
  return { step, units, best, via };
}

function planFor(table: Table, index: number, sizes: number[], dose: number): VialPlan {
  const counts = new Map<number, number>();
  for (let t = index; t > 0; ) {
    const i = table.via[t];
    counts.set(sizes[i], (counts.get(sizes[i]) ?? 0) + 1);
    t -= table.units[i];
  }
  const total = round((index * table.step) / SCALE, 6);
  const waste = round(Math.max(0, total - dose), 6);
  return {
    counts: [...counts].map(([amount, count]) => ({ amount, count })).sort((a, b) => b.amount - a.amount),
    total,
    waste,
    wastePct: total > 0 ? round((waste / total) * 100, 1) : 0,
    vials: [...counts.values()].reduce((a, b) => a + b, 0),
  };
}

function distinctSizes(sizes: VialSize[]): number[] {
  return [...new Set(sizes.map((s) => s.amount).filter((a) => Number.isFinite(a) && a > 0))].sort((a, b) => b - a);
}

/**
 * The combination of whole containers that covers the dose with the least drug left
 * over; ties go to fewer containers. Returns null when nothing can be computed.
 */
export function leastWastePlan(dose: number, available: VialSize[]): VialPlan | null {
  const sizes = distinctSizes(available);
  if (!(dose > 0) || !sizes.length) return null;
  const table = reachable(sizes, dose + sizes[0]);
  if (!table) return null;
  const start = Math.ceil(Math.round(dose * SCALE) / table.step);
  for (let t = start; t < table.best.length; t++) if (table.best[t] !== Infinity) return planFor(table, t, sizes, dose);
  return null;
}

/** The fewest containers of one size that cover the dose (for comparison with mixing sizes). */
export function singleSizePlans(dose: number, available: VialSize[]): VialPlan[] {
  return distinctSizes(available).map((amount) => {
    const count = Math.ceil(round(dose / amount, 9));
    const total = round(count * amount, 6);
    const waste = round(total - dose, 6);
    return { counts: [{ amount, count }], total, waste, wastePct: round((waste / total) * 100, 1), vials: count };
  });
}

export interface RoundingCandidate {
  dose: number;
  /** Signed change from the prescribed dose, in percent. */
  changePct: number;
  plan: VialPlan;
}

/**
 * Whole-container doses within ±thresholdPct of the prescribed dose: the nearest one
 * at or below it and the nearest one above it. Both leave no drug in opened containers.
 */
export function roundingCandidates(dose: number, available: VialSize[], thresholdPct: number): { down: RoundingCandidate | null; up: RoundingCandidate | null } {
  const sizes = distinctSizes(available);
  if (!(dose > 0) || !sizes.length || !(thresholdPct >= 0)) return { down: null, up: null };
  const high = dose * (1 + thresholdPct / 100);
  const low = dose * (1 - thresholdPct / 100);
  const table = reachable(sizes, high);
  if (!table) return { down: null, up: null };
  const at = Math.round(dose * SCALE) / table.step;
  const candidate = (t: number): RoundingCandidate => {
    const plan = planFor(table, t, sizes, (t * table.step) / SCALE);
    return { dose: plan.total, changePct: round(((plan.total - dose) / dose) * 100, 1), plan };
  };
  let down: RoundingCandidate | null = null;
  for (let t = Math.floor(at); t >= 1 && (t * table.step) / SCALE >= low - 1e-9; t--) {
    if (table.best[t] !== Infinity) {
      down = candidate(t);
      break;
    }
  }
  let up: RoundingCandidate | null = null;
  for (let t = Math.floor(at) + 1; t < table.best.length && (t * table.step) / SCALE <= high + 1e-9; t++) {
    if (table.best[t] !== Infinity) {
      up = candidate(t);
      break;
    }
  }
  return { down, up };
}
