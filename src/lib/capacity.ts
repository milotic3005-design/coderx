/**
 * Infusion chair capacity arithmetic. Every input (chairs, hours, chair time per visit,
 * visits per day) comes from the user; nothing clinical is assumed.
 */

export interface VisitType {
  name: string;
  /** Chair time for one visit, in minutes (infusion plus pre/post observation). */
  chairMinutes: number;
  /** Expected visits per day. */
  perDay: number;
}

export interface CapacityInput {
  chairs: number;
  /** Minutes the unit is open per day. */
  openMinutes: number;
  /** Cleaning / turnover minutes between patients in the same chair. */
  turnoverMinutes: number;
  /** Planning target for chair utilization, in percent (e.g. 85). */
  targetPct: number;
  visits: VisitType[];
}

export interface CapacityResult {
  availableMinutes: number;
  demandMinutes: number;
  utilizationPct: number;
  chairsNeeded: number;
  /** Extra visits of the average length that fit before reaching the target. */
  headroomVisits: number;
  tooLong: string[];
  byType: { name: string; visits: number; minutes: number; sharePct: number }[];
}

const r1 = (x: number) => Math.round(x * 10) / 10;

export function planCapacity(input: CapacityInput): CapacityResult {
  const visits = input.visits.filter((v) => v.chairMinutes > 0 && v.perDay > 0);
  const slot = (v: VisitType) => v.chairMinutes + Math.max(0, input.turnoverMinutes);
  const availableMinutes = Math.max(0, input.chairs) * Math.max(0, input.openMinutes);
  const demandMinutes = visits.reduce((n, v) => n + v.perDay * slot(v), 0);
  const target = Math.min(100, Math.max(1, input.targetPct)) / 100;
  const totalVisits = visits.reduce((n, v) => n + v.perDay, 0);
  const avgSlot = totalVisits ? demandMinutes / totalVisits : 0;
  return {
    availableMinutes,
    demandMinutes,
    utilizationPct: availableMinutes ? r1((demandMinutes / availableMinutes) * 100) : 0,
    chairsNeeded: input.openMinutes > 0 ? Math.ceil(demandMinutes / (input.openMinutes * target)) : 0,
    headroomVisits: avgSlot ? Math.max(0, Math.floor((availableMinutes * target - demandMinutes) / avgSlot)) : 0,
    tooLong: visits.filter((v) => v.chairMinutes > input.openMinutes).map((v) => v.name),
    byType: visits.map((v) => ({ name: v.name, visits: v.perDay, minutes: v.perDay * slot(v), sharePct: demandMinutes ? r1(((v.perDay * slot(v)) / demandMinutes) * 100) : 0 })),
  };
}

export interface ChairDay {
  /** Booked blocks in order: visit type index and minutes (including turnover). */
  blocks: { type: number; minutes: number }[];
  minutes: number;
}

/**
 * A first look at whether the day packs: longest visits first, each to the chair with
 * the least booked time. Visits that do not fit any chair are returned as overflow.
 */
export function packChairs(input: CapacityInput): { chairs: ChairDay[]; overflow: { type: number; count: number }[] } {
  const chairs: ChairDay[] = Array.from({ length: Math.max(0, Math.min(200, Math.floor(input.chairs))) }, () => ({ blocks: [], minutes: 0 }));
  const queue: { type: number; minutes: number }[] = [];
  input.visits.forEach((v, type) => {
    if (v.chairMinutes > 0) for (let i = 0; i < Math.min(1000, Math.floor(v.perDay)); i++) queue.push({ type, minutes: v.chairMinutes + Math.max(0, input.turnoverMinutes) });
  });
  queue.sort((a, b) => b.minutes - a.minutes);
  const overflow = new Map<number, number>();
  for (const visit of queue) {
    const chair = chairs.reduce<ChairDay | null>((best, c) => (c.minutes + visit.minutes - input.turnoverMinutes <= input.openMinutes && (!best || c.minutes < best.minutes) ? c : best), null);
    if (chair) {
      chair.blocks.push(visit);
      chair.minutes += visit.minutes;
    } else overflow.set(visit.type, (overflow.get(visit.type) ?? 0) + 1);
  }
  return { chairs, overflow: [...overflow].map(([type, count]) => ({ type, count })) };
}
