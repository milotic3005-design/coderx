"use client";

import { Building2, Home, Plus, Save, Trash2, Upload } from "lucide-react";
import { useId, useState, useSyncExternalStore, type ReactNode } from "react";
import type { SiteOfCareData } from "@/lib/data/tools";
import { ADMIN_PRESETS, additionalHours, compareSites, type DrugBasis, type Frequency, type HcaFee, type LineSource, type Payer, type PayerComparison, type SiteResult } from "@/lib/site-of-care";
import { TableScroll, td, th } from "../layout-bits";

const KEY = "coderx:site-of-care";
const PAYERS: Record<Payer, string> = { medicare: "Medicare fee-for-service", apple_health: "Washington Apple Health", commercial: "Commercial (your contract)" };
const SOURCE_LABEL: Record<LineSource, string> = {
  cms_opps_addendum_a: "CMS OPPS Addendum A",
  cms_opps_addendum_b: "CMS OPPS Addendum B",
  cms_payment_limits: "CMS payment limit file",
  wa_hca_home_infusion: "WA HCA fee schedule",
  you: "You entered",
};
const FREQ: Record<Frequency, string> = { admin: "per administration", week: "per week", month: "per month" };

type PresetId = (typeof ADMIN_PRESETS)[number]["id"] | "custom";

interface Scenario {
  preset: PresetId;
  minutes: string;
  apcCounts: Record<string, string>;
  wageIndex: string;
  remedy: boolean;
  mcrHomePartB: boolean;
  mcrDme: string;
  mcrPartD: string;
  ahHopdVisit: string;
  ahHopdDrug: string;
  ahHomeDrug: string;
  ahDispFee: string;
  ahFills: string;
  ahArea: string;
  ahItems: { key: string; qty: string; freq: Frequency }[];
  ahNursing: string;
  ahNursingVisits: string;
  cmHopdDrugKind: DrugBasis["kind"];
  cmHopdDrug: string;
  cmHopdAdminKind: "pct_medicare" | "per_visit";
  cmHopdAdmin: string;
  cmHomeDrugKind: DrugBasis["kind"];
  cmHomeDrug: string;
  cmPerDiem: string;
  cmPerDiemDays: string;
  cmNursing: string;
  cmNursingVisits: string;
  cmOther: string;
  costHopd: string;
  costHome: string;
}

function presetCounts(preset: PresetId, minutes: number): Record<string, string> {
  const p = ADMIN_PRESETS.find((x) => x.id === preset);
  if (!p) return {};
  const out: Record<string, string> = { [p.first]: "1" };
  if (p.extra) out[p.extra] = String(additionalHours(minutes));
  return out;
}

const DEFAULTS: Scenario = {
  preset: "complex",
  minutes: "120",
  apcCounts: presetCounts("complex", 120),
  wageIndex: "1.0000",
  remedy: true,
  mcrHomePartB: false,
  mcrDme: "",
  mcrPartD: "",
  ahHopdVisit: "",
  ahHopdDrug: "",
  ahHomeDrug: "",
  ahDispFee: "",
  ahFills: "1",
  ahArea: "Non-rural",
  ahItems: [],
  ahNursing: "",
  ahNursingVisits: "1",
  cmHopdDrugKind: "pct_asp",
  cmHopdDrug: "",
  cmHopdAdminKind: "pct_medicare",
  cmHopdAdmin: "",
  cmHomeDrugKind: "pct_asp",
  cmHomeDrug: "",
  cmPerDiem: "",
  cmPerDiemDays: "1",
  cmNursing: "",
  cmNursingVisits: "1",
  cmOther: "",
  costHopd: "",
  costHome: "",
};

const noop = () => () => {};
function savedSnapshot(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Blank → null; otherwise a finite number ≥ 0. */
const val = (v: string): number | null => {
  if (!v.trim()) return null;
  const n = Number(v.replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${usd(Math.abs(n))}`;
const itemKey = (r: { code: string; modifier: string | null }) => `${r.code}${r.modifier ? `-${r.modifier}` : ""}`;

const field = "mt-1 block min-h-11 w-full rounded-lg border border-rule-strong bg-surface-raised px-3 text-base text-ink";
const box = "space-y-4 rounded-xl border hairline bg-surface p-5 sm:p-6";
const button = "inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-rule-strong px-3 text-sm font-semibold text-ink hover:border-brand hover:text-brand";

function Num({ label, value, onChange, hint, suffix }: { label: string; value: string; onChange: (v: string) => void; hint?: string; suffix?: string }) {
  return (
    <label className="block text-sm font-semibold text-ink">
      {label}
      {suffix ? <span className="font-normal text-ink-muted"> ({suffix})</span> : null}
      <input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" className={field} />
      {hint ? <span className="mt-1 block text-xs font-normal text-ink-muted">{hint}</span> : null}
    </label>
  );
}

function Group({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="space-y-3 border-t hairline pt-4 first:border-t-0 first:pt-0">
      <legend className="flex items-center gap-2 text-sm font-semibold tracking-wide text-ink-faint uppercase">
        {icon}
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function SiteCell({ r }: { r: SiteResult }) {
  if (r.status !== "computed") return <span className="text-sm text-ink-muted">Needs input</span>;
  return (
    <span className="code-chip font-semibold text-ink">
      {usd(r.expected)}
      <span className="block font-sans text-xs font-normal text-ink-muted">{usd(r.expected * 12)} / year</span>
    </span>
  );
}

function Breakdown({ title, r }: { title: string; r: SiteResult }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-semibold text-ink">{title}</p>
      {r.lines.length ? (
        <ul className="mt-2 space-y-2">
          {r.lines.map((l, i) => (
            <li key={i} className="rounded-lg border hairline p-3 text-sm">
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-ink">{l.label}</span>
                <span className="code-chip font-semibold text-ink">{usd(l.amount)}</span>
              </span>
              <span className="mt-0.5 block text-xs text-ink-muted">
                {l.formula} · <span className="font-semibold">{SOURCE_LABEL[l.source]}</span>
                {l.patientShare ? ` · patient coinsurance ${usd(l.patientShare)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <dt className="text-ink-muted">Allowed</dt>
        <dd className="code-chip text-right text-ink">{usd(r.allowed)}</dd>
        {r.patientShare ? (
          <>
            <dt className="text-ink-muted">Patient coinsurance</dt>
            <dd className="code-chip text-right text-ink">{usd(r.patientShare)}</dd>
          </>
        ) : null}
        <dt className="font-semibold text-ink">Expected</dt>
        <dd className="code-chip text-right font-semibold text-ink">{usd(r.expected)}</dd>
        {r.cost != null ? (
          <>
            <dt className="text-ink-muted">Drug cost</dt>
            <dd className="code-chip text-right text-ink">{usd(r.cost)}</dd>
            {r.margin != null ? (
              <>
                <dt className="text-ink-muted">Margin</dt>
                <dd className={`code-chip text-right font-semibold ${r.margin < 0 ? "text-danger" : "text-ok"}`}>{signed(r.margin)}</dd>
              </>
            ) : null}
          </>
        ) : null}
      </dl>
      {r.missing.length ? <p className="mt-2 text-sm font-semibold text-danger">Needs: {r.missing.join("; ")}.</p> : null}
      {r.notes.length ? (
        <ul className="mt-2 space-y-1 text-xs text-ink-muted">
          {r.notes.map((n) => (
            <li key={n}>• {n}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function verdict(c: PayerComparison): ReactNode {
  if (c.better == null || c.difference == null) return <span className="text-sm text-ink-muted">Add the missing inputs</span>;
  if (c.better === "same") return <span className="text-sm font-semibold text-ink">Same</span>;
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${c.better === "home" ? "text-ok" : "text-brand"}`}>
      {c.better === "home" ? <Home aria-hidden="true" className="h-4 w-4" /> : <Building2 aria-hidden="true" className="h-4 w-4" />}
      {c.better === "home" ? "Home infusion" : "HOPD"} by {usd(Math.abs(c.difference))}/mo
    </span>
  );
}

export function SiteOfCareTool({ data, initialUnits, initialPerMonth }: { data: SiteOfCareData; initialUnits: string; initialPerMonth: string }) {
  const id = useId();
  const [units, setUnits] = useState(initialUnits);
  const [perMonth, setPerMonth] = useState(initialPerMonth);
  const [s, setS] = useState<Scenario>(DEFAULTS);
  const [savedTick, setSavedTick] = useState(0);
  const saved = useSyncExternalStore(noop, savedSnapshot, () => null);
  const set = (patch: Partial<Scenario>) => setS((prev) => ({ ...prev, ...patch }));

  const areas = [...new Set((data.hca?.rows ?? []).flatMap((r) => r.fees.map((f) => f.area)))];
  const hcaByKey = new Map((data.hca?.rows ?? []).map((r) => [itemKey(r), r]));
  const hcaFee = (key: string): HcaFee | null => {
    const r = hcaByKey.get(key);
    if (!r) return null;
    const f = r.fees.find((x) => x.area === s.ahArea) ?? r.fees[0];
    return { code: r.code, modifier: r.modifier, label: r.label ?? "", amount: f?.amount != null ? Number(f.amount) : null, text: f?.text ?? "" };
  };

  const unitsN = val(units) ?? 0;
  const perMonthN = val(perMonth) ?? 0;
  const drugBasis = (kind: DrugBasis["kind"], v: string): DrugBasis | null => {
    const n = val(v);
    return n == null ? null : kind === "pct_asp" ? { kind, pct: n } : { kind, amount: n };
  };
  const adminN = val(s.cmHopdAdmin);
  const results =
    unitsN > 0 && perMonthN > 0
      ? compareSites({
          drug: {
            code: data.code,
            aspLimit: data.asp?.limit ?? null,
            aspCoinsurancePct: data.asp?.coinsurancePct ?? null,
            opps: data.opps ? { statusIndicator: data.opps.statusIndicator, paymentRate: data.opps.paymentRate, copayPerUnit: data.opps.copayPerUnit } : null,
          },
          unitsPerAdmin: unitsN,
          adminsPerMonth: perMonthN,
          hopd: {
            apcLines: data.apcs.map((apc) => ({ apc, count: val(s.apcCounts[apc.apc] ?? "") ?? 0 })),
            wageIndex: val(s.wageIndex) ?? 1,
            applyRemedyOffset: s.remedy,
            remedyOffset: data.remedyOffset,
          },
          medicare: { homePartB: s.mcrHomePartB, homeDmePerMonth: val(s.mcrDme), homePartDPerUnit: val(s.mcrPartD) },
          appleHealth: {
            hopdVisit: val(s.ahHopdVisit),
            hopdDrugPerUnit: val(s.ahHopdDrug),
            homeDrugPerUnit: val(s.ahHomeDrug),
            homeDispensingFee: val(s.ahDispFee),
            fillsPerMonth: val(s.ahFills) ?? 0,
            hcaItems: s.ahItems.flatMap((it) => {
              const fee = hcaFee(it.key);
              return fee ? [{ fee, quantity: val(it.qty) ?? 0, frequency: it.freq }] : [];
            }),
            nursingPerVisit: val(s.ahNursing),
            nursingVisitsPerAdmin: val(s.ahNursingVisits) ?? 0,
          },
          commercial: {
            hopdDrug: drugBasis(s.cmHopdDrugKind, s.cmHopdDrug),
            hopdAdmin: adminN == null ? null : s.cmHopdAdminKind === "pct_medicare" ? { kind: "pct_medicare", pct: adminN } : { kind: "per_visit", amount: adminN },
            homeDrug: drugBasis(s.cmHomeDrugKind, s.cmHomeDrug),
            perDiem: val(s.cmPerDiem),
            perDiemDaysPerMonth: val(s.cmPerDiemDays) ?? 0,
            nursingPerVisit: val(s.cmNursing),
            nursingVisitsPerAdmin: val(s.cmNursingVisits) ?? 0,
            homeOtherPerMonth: val(s.cmOther),
          },
          cost: { hopdPerUnit: val(s.costHopd), homePerUnit: val(s.costHome) },
          sequestrationPct: 2,
        })
      : null;

  const choosePreset = (preset: PresetId) => set(preset === "custom" ? { preset } : { preset, apcCounts: presetCounts(preset, val(s.minutes) ?? 0) });
  const presetDef = ADMIN_PRESETS.find((p) => p.id === s.preset);
  const addItem = (key: string) => {
    if (!key || s.ahItems.some((i) => i.key === key)) return;
    const freq: Frequency = /^E0/.test(key) ? "month" : key === "A4221" ? "week" : "admin";
    set({ ahItems: [...s.ahItems, { key, qty: "1", freq }] });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <section aria-labelledby={`${id}-in`} className={box}>
        <h2 id={`${id}-in`} className="font-display text-xl font-semibold text-ink">
          Therapy and terms
        </h2>

        <Group title="Therapy">
          <div className="grid grid-cols-2 gap-3">
            <Num label="Units per administration" value={units} onChange={setUnits} hint={data.asp?.dosage ? `1 unit = ${data.asp.dosage} (CMS)` : undefined} />
            <Num label="Administrations per month" value={perMonth} onChange={setPerMonth} hint="e.g. 1 for monthly, 0.5 for every 8 weeks" />
          </div>
        </Group>

        <Group title="Hospital outpatient (Medicare)" icon={<Building2 aria-hidden="true" className="h-4 w-4" />}>
          <label className="block text-sm font-semibold text-ink">
            Administration per visit
            <select value={s.preset} onChange={(e) => choosePreset(e.target.value as PresetId)} className={field}>
              {ADMIN_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
              <option value="custom">Custom APC counts</option>
            </select>
          </label>
          {presetDef?.extra ? (
            <Num
              label="Infusion time"
              suffix="minutes"
              value={s.minutes}
              onChange={(v) => set({ minutes: v, apcCounts: presetCounts(s.preset, val(v) ?? 0) })}
              hint="One additional hour counts once the extra time passes 30 minutes."
            />
          ) : null}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {data.apcs.map((a) => (
              <label key={a.apc} className="block text-xs font-semibold text-ink-muted">
                APC {a.apc} · {a.title}
                <input
                  value={s.apcCounts[a.apc] ?? "0"}
                  onChange={(e) => set({ preset: "custom", apcCounts: { ...s.apcCounts, [a.apc]: e.target.value } })}
                  inputMode="numeric"
                  className={field}
                  aria-label={`APC ${a.apc} ${a.title ?? ""} per visit`}
                />
              </label>
            ))}
          </div>
          <p className="text-xs text-ink-muted">Presets use the APC levels CMS assigned these services for CY 2026. Check them against your remittances; count only APCs Medicare pays (some injections are packaged when billed with an infusion).</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Num label="Hospital wage index" value={s.wageIndex} onChange={(v) => set({ wageIndex: v })} hint="From the CMS IPPS wage index table for your hospital (1.0000 = national)." />
            <label className="flex items-start gap-2 pt-7 text-sm text-ink">
              <input type="checkbox" checked={s.remedy} onChange={(e) => set({ remedy: e.target.checked })} className="mt-1 h-4 w-4 accent-[var(--brand)]" />
              <span>
                Apply the 340B remedy offset{data.remedyOffset ? ` (× ${data.remedyOffset.ratio})` : ""}
                <span className="block text-xs text-ink-muted">CMS applies it to a subset of hospitals; uncheck if yours is exempt.</span>
              </span>
            </label>
          </div>
        </Group>

        <Group title="Home infusion (Medicare, not HIT certified)" icon={<Home aria-hidden="true" className="h-4 w-4" />}>
          <label className="flex items-start gap-2 text-sm text-ink">
            <input type="checkbox" checked={s.mcrHomePartB} onChange={(e) => set({ mcrHomePartB: e.target.checked })} className="mt-1 h-4 w-4 accent-[var(--brand)]" />
            <span>
              Part B covers this drug at home and you bill it as a DMEPOS supplier
              <span className="block text-xs text-ink-muted">For example an infusion pump drug under the DME MAC External Infusion Pump policy, or IVIG for primary immune deficiency. Otherwise the drug is Part D.</span>
            </span>
          </label>
          {s.mcrHomePartB ? (
            <Num label="Pump rental and supplies" suffix="$ per month" value={s.mcrDme} onChange={(v) => set({ mcrDme: v })} hint="From the CMS DMEPOS fee schedule for Washington (optional)." />
          ) : (
            <Num label="Part D plan payment" suffix="$ per unit" value={s.mcrPartD} onChange={(v) => set({ mcrPartD: v })} />
          )}
        </Group>

        <Group title="Washington Apple Health">
          <div className="grid gap-3 sm:grid-cols-2">
            <Num label="HOPD: EAPG payment" suffix="$ per visit" value={s.ahHopdVisit} onChange={(v) => set({ ahHopdVisit: v })} hint="From your Apple Health remittances." />
            <Num label="HOPD: drug paid outside EAPG" suffix="$ per unit" value={s.ahHopdDrug} onChange={(v) => set({ ahHopdDrug: v })} hint="Only for high-cost drugs HCA carves out; leave blank otherwise." />
            <Num label="Home: drug payment" suffix="$ per unit" value={s.ahHomeDrug} onChange={(v) => set({ ahHomeDrug: v })} />
            <div className="grid grid-cols-2 gap-2">
              <Num label="Dispensing fee" suffix="$" value={s.ahDispFee} onChange={(v) => set({ ahDispFee: v })} />
              <Num label="Fills / month" value={s.ahFills} onChange={(v) => set({ ahFills: v })} />
            </div>
            <Num label="Home: nursing visit" suffix="$ per visit" value={s.ahNursing} onChange={(v) => set({ ahNursing: v })} />
            <Num label="Nursing visits per administration" value={s.ahNursingVisits} onChange={(v) => set({ ahNursingVisits: v })} />
          </div>
          {data.hca ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-sm font-semibold text-ink">
                  HCA payment area
                  <select value={s.ahArea} onChange={(e) => set({ ahArea: e.target.value })} className={field}>
                    {areas.map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </select>
                </label>
                <label className="min-w-0 flex-1 text-sm font-semibold text-ink">
                  Add a supply or pump code (HCA schedule)
                  <select value="" onChange={(e) => addItem(e.target.value)} className={field}>
                    <option value="">Choose…</option>
                    {(data.hca.rows ?? []).map((r) => (
                      <option key={itemKey(r)} value={itemKey(r)}>
                        {r.label ? `${itemKey(r)} — ${r.label}` : itemKey(r)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {s.ahItems.length ? (
                <ul className="space-y-2">
                  {s.ahItems.map((it, i) => {
                    const fee = hcaFee(it.key);
                    return (
                      <li key={it.key} className="grid grid-cols-[minmax(0,1fr)_4.5rem_auto_auto] items-end gap-2 rounded-lg border hairline p-2">
                        <span className="text-sm text-ink">
                          <span className="code-chip font-semibold">{it.key}</span> {fee?.label}
                          <span className="block text-xs text-ink-muted">HCA maximum: {fee?.amount != null ? usd(fee.amount) : (fee?.text ?? "—")}</span>
                        </span>
                        <label className="text-xs font-semibold text-ink-muted">
                          Qty
                          <input value={it.qty} onChange={(e) => set({ ahItems: s.ahItems.map((x, k) => (k === i ? { ...x, qty: e.target.value } : x)) })} inputMode="decimal" className={field} />
                        </label>
                        <label className="text-xs font-semibold text-ink-muted">
                          How often
                          <select value={it.freq} onChange={(e) => set({ ahItems: s.ahItems.map((x, k) => (k === i ? { ...x, freq: e.target.value as Frequency } : x)) })} className={field}>
                            {(Object.keys(FREQ) as Frequency[]).map((f) => (
                              <option key={f} value={f}>
                                {FREQ[f]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button type="button" onClick={() => set({ ahItems: s.ahItems.filter((_, k) => k !== i) })} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-ink-muted hover:bg-paper-sunken hover:text-danger">
                          <Trash2 aria-hidden="true" className="h-4 w-4" />
                          <span className="sr-only">Remove {it.key}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {["A4222", "A4221", "E0781-RR"]
                    .filter((k) => hcaByKey.has(k))
                    .map((k) => (
                      <button key={k} type="button" onClick={() => addItem(k)} className={button}>
                        <Plus aria-hidden="true" className="h-4 w-4" /> {k}
                      </button>
                    ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-ink-muted">No authoritative public data was located for this field.</p>
          )}
        </Group>

        <Group title="Commercial (your contract)">
          <div className="grid gap-3 sm:grid-cols-2">
            <BasisInput label="HOPD drug" kind={s.cmHopdDrugKind} value={s.cmHopdDrug} onKind={(k) => set({ cmHopdDrugKind: k })} onValue={(v) => set({ cmHopdDrug: v })} />
            <label className="block text-sm font-semibold text-ink">
              HOPD administration
              <span className="mt-1 grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2">
                <select value={s.cmHopdAdminKind} onChange={(e) => set({ cmHopdAdminKind: e.target.value as Scenario["cmHopdAdminKind"] })} className={field}>
                  <option value="pct_medicare">% of Medicare OPPS</option>
                  <option value="per_visit">$ per visit</option>
                </select>
                <input value={s.cmHopdAdmin} onChange={(e) => set({ cmHopdAdmin: e.target.value })} inputMode="decimal" className={field} aria-label="HOPD administration amount" />
              </span>
            </label>
            <BasisInput label="Home drug" kind={s.cmHomeDrugKind} value={s.cmHomeDrug} onKind={(k) => set({ cmHomeDrugKind: k })} onValue={(v) => set({ cmHomeDrug: v })} />
            <div className="grid grid-cols-2 gap-2">
              <Num label="Per diem" suffix="$ / day" value={s.cmPerDiem} onChange={(v) => set({ cmPerDiem: v })} />
              <Num label="Days / month" value={s.cmPerDiemDays} onChange={(v) => set({ cmPerDiemDays: v })} />
            </div>
            <Num label="Nursing visit" suffix="$ per visit" value={s.cmNursing} onChange={(v) => set({ cmNursing: v })} />
            <Num label="Nursing visits per administration" value={s.cmNursingVisits} onChange={(v) => set({ cmNursingVisits: v })} />
            <Num label="Other home items" suffix="$ per month" value={s.cmOther} onChange={(v) => set({ cmOther: v })} />
          </div>
        </Group>

        <Group title="Drug acquisition cost (optional)">
          <div className="grid grid-cols-2 gap-3">
            <Num label="HOPD" suffix="$ per unit" value={s.costHopd} onChange={(v) => set({ costHopd: v })} hint="e.g. your 340B price" />
            <Num label="Home pharmacy" suffix="$ per unit" value={s.costHome} onChange={(v) => set({ costHome: v })} />
          </div>
        </Group>

        <div className="flex flex-wrap gap-2 border-t hairline pt-4">
          <button
            type="button"
            onClick={() => {
              try {
                window.localStorage.setItem(KEY, JSON.stringify(s));
                setSavedTick((t) => t + 1);
              } catch {
                // storage unavailable
              }
            }}
            className={button}
          >
            <Save aria-hidden="true" className="h-4 w-4" /> Save terms in this browser
          </button>
          {saved || savedTick > 0 ? (
            <button
              type="button"
              onClick={() => {
                try {
                  const v = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Partial<Scenario> | null;
                  if (v && typeof v === "object") setS({ ...DEFAULTS, ...v });
                } catch {
                  // ignore a damaged saved scenario
                }
              }}
              className={button}
            >
              <Upload aria-hidden="true" className="h-4 w-4" /> Load saved terms
            </button>
          ) : null}
        </div>
      </section>

      <section aria-labelledby={`${id}-out`} aria-live="polite" tabIndex={0} className="min-w-0 space-y-4 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
        <h2 id={`${id}-out`} className="font-display text-xl font-semibold text-ink">
          Expected revenue per month
        </h2>
        {results ? (
          <>
            <TableScroll label="Site comparison by payer">
              <table className="w-full min-w-[36rem] border-collapse">
                <caption className="sr-only">Expected revenue per month at each site, by payer</caption>
                <thead>
                  <tr>
                    {["Payer", "HOPD", "Home infusion", "Pays more"].map((h) => (
                      <th key={h} scope="col" className={th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map((c) => (
                    <tr key={c.payer}>
                      <th scope="row" className={`${td} text-left font-semibold text-ink`}>
                        {PAYERS[c.payer]}
                      </th>
                      <td className={td}>
                        <SiteCell r={c.hopd} />
                      </td>
                      <td className={td}>
                        <SiteCell r={c.home} />
                      </td>
                      <td className={td}>{verdict(c)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            <p className="text-xs text-ink-muted">
              Expected = allowed amount, with Medicare Part B&apos;s share reduced 2% for sequestration and the patient coinsurance counted as collected. {unitsN} unit{unitsN === 1 ? "" : "s"} × {perMonthN} administration{perMonthN === 1 ? "" : "s"} a month.
            </p>
            {results.map((c) => (
              <details key={c.payer} className="rounded-xl border hairline bg-surface p-4" open={c.payer === "medicare"}>
                <summary className="cursor-pointer text-base font-semibold text-ink">{PAYERS[c.payer]}: how it adds up</summary>
                <div className="mt-3 grid gap-5 md:grid-cols-2">
                  <Breakdown title="HOPD" r={c.hopd} />
                  <Breakdown title="Home infusion" r={c.home} />
                </div>
              </details>
            ))}
          </>
        ) : (
          <p className="rounded-xl border hairline bg-surface p-5 text-sm text-ink-muted">Enter the units per administration and administrations per month.</p>
        )}
      </section>
    </div>
  );
}

function BasisInput({ label, kind, value, onKind, onValue }: { label: string; kind: DrugBasis["kind"]; value: string; onKind: (k: DrugBasis["kind"]) => void; onValue: (v: string) => void }) {
  return (
    <label className="block text-sm font-semibold text-ink">
      {label}
      <span className="mt-1 grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2">
        <select value={kind} onChange={(e) => onKind(e.target.value as DrugBasis["kind"])} className={field}>
          <option value="pct_asp">% of CMS payment limit (ASP)</option>
          <option value="per_unit">$ per unit</option>
        </select>
        <input value={value} onChange={(e) => onValue(e.target.value)} inputMode="decimal" className={field} aria-label={`${label} amount`} />
      </span>
    </label>
  );
}
