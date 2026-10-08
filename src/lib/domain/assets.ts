// Fixed assets and depreciation (HANDOFF rule 12). Schedules are recomputed from
// the register every time, never stored, so a corrected cost or date reflows everything.
// Money is integer paise; months are "YYYY-MM".

export const ASSET_CATEGORIES = [
  "Cardio equipment",
  "Strength equipment",
  "Free weights",
  "Electronics & computers",
  "Furniture & fixtures",
  "Air conditioning",
  "Software & licences",
  "Vehicles",
  "Other",
] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

/** Default [WDV rate % per year, SLM life in years], from Indian income-tax rates. */
export const DEP_DEFAULT: Record<AssetCategory, [number, number]> = {
  "Cardio equipment": [15, 8],
  "Strength equipment": [15, 10],
  "Free weights": [15, 10],
  "Electronics & computers": [40, 3],
  "Furniture & fixtures": [10, 10],
  "Air conditioning": [15, 8],
  "Software & licences": [40, 3],
  Vehicles: [15, 8],
  Other: [15, 5],
};

export const depDefault = (category: string) => DEP_DEFAULT[category as AssetCategory] ?? DEP_DEFAULT.Other;

export type AssetLike = {
  cost: number;
  salvage: number;
  method: "WDV" | "SLM";
  /** WDV: % per financial year. */
  rate: number | null;
  /** SLM: years. */
  life: number | null;
  /** YYYY-MM-DD */
  purchaseDate: string;
  /** Imported assets: depreciation already charged before switching to Fitron, and the month to continue from. */
  accDepCarried?: number;
  depFrom?: string | null;
  /** YYYY-MM-DD when sold or scrapped. */
  disposedOn?: string | null;
  disposedFor?: number | null;
};

export type ScheduleRow = { ym: string; dep: number; nbv: number; fy: number };

export const ymOf = (d: string) => d.slice(0, 7);
export const nextYm = (k: string) => {
  const y = Number(k.slice(0, 4));
  const m = Number(k.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};
/** Indian financial year (April to March), named by the year it starts. */
export const fyOf = (ym: string) => {
  const y = Number(ym.slice(0, 4));
  return Number(ym.slice(5, 7)) >= 4 ? y : y - 1;
};
export const fyLabel = (fy: number) => `FY ${fy}–${String(fy + 1).slice(2)}`;

/**
 * Month-by-month depreciation up to and including `upTo` (YYYY-MM).
 * The purchase month counts as a full month. WDV re-bases on the opening value every April.
 * The charge never takes book value below salvage, and stops after the disposal month.
 */
export function depSchedule(a: AssetLike, upTo: string): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  const carried = a.accDepCarried ?? 0;
  let nbv = a.cost - carried;
  let fyBase = nbv;
  let k = a.depFrom || ymOf(a.purchaseDate);
  const end = a.disposedOn ? ymOf(a.disposedOn) : upTo;
  for (let n = 0; k <= end && k <= upTo && n < 1200; n++) {
    if (k.slice(5, 7) === "04") fyBase = nbv;
    const raw = a.method === "SLM" ? (a.cost - a.salvage) / Math.max(1, (a.life ?? 1) * 12) : (fyBase * (a.rate ?? 0)) / 100 / 12;
    const dep = Math.max(0, Math.min(Math.round(raw), nbv - a.salvage));
    nbv -= dep;
    rows.push({ ym: k, dep, nbv, fy: fyOf(k) });
    k = nextYm(k);
  }
  return rows;
}

/** Accumulated depreciation, book value, this FY's charge and (if disposed) the gain or loss, as of `upTo`. */
export function assetInfo(a: AssetLike, upTo: string) {
  const sch = depSchedule(a, upTo);
  const acc = sch.reduce((s, r) => s + r.dep, 0) + (a.accDepCarried ?? 0);
  const nbv = a.cost - acc;
  const fy = fyOf(upTo);
  const fyDep = sch.filter((r) => r.fy === fy).reduce((s, r) => s + r.dep, 0);
  const gain = a.disposedOn ? (a.disposedFor ?? 0) - nbv : 0;
  const last = sch[sch.length - 1];
  return { sch, acc, nbv, fyDep, gain, monthDep: last ? last.dep : 0 };
}

/** Depreciation charged across the months from `fromYm` to `toYm` inclusive. */
export const depreciationIn = (assets: AssetLike[], fromYm: string, toYm: string) =>
  assets.reduce((s, a) => s + depSchedule(a, toYm).filter((r) => r.ym >= fromYm).reduce((t, r) => t + r.dep, 0), 0);

/** Gains and losses on assets disposed between two dates (YYYY-MM-DD, inclusive). */
export function disposalsIn(assets: AssetLike[], from: string, to: string) {
  let gain = 0;
  let loss = 0;
  for (const a of assets) {
    if (!a.disposedOn || a.disposedOn < from || a.disposedOn > to) continue;
    const g = assetInfo(a, ymOf(a.disposedOn)).gain;
    if (g >= 0) gain += g;
    else loss -= g;
  }
  return { gain, loss };
}

/** Rows grouped by financial year: opening value, charge, closing value. */
export function scheduleByFy(a: AssetLike, upTo: string) {
  const sch = depSchedule(a, upTo);
  const out: { fy: number; opening: number; dep: number; closing: number }[] = [];
  let opening = a.cost - (a.accDepCarried ?? 0);
  for (const r of sch) {
    let row = out[out.length - 1];
    if (!row || row.fy !== r.fy) {
      row = { fy: r.fy, opening, dep: 0, closing: opening };
      out.push(row);
    }
    row.dep += r.dep;
    row.closing = r.nbv;
    opening = r.nbv;
  }
  return out;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Depreciation schedule shaped for display: by financial year (oldest first) or by month (newest first, at most 36). */
export function scheduleView(a: AssetLike, upTo: string, mode: "year" | "month"): { period: string; dep: number; closing: number }[] {
  if (mode === "year") return scheduleByFy(a, upTo).map((r) => ({ period: fyLabel(r.fy), dep: r.dep, closing: r.closing }));
  return depSchedule(a, upTo)
    .slice(-36)
    .reverse()
    .map((r) => ({ period: `${MON[Number(r.ym.slice(5, 7)) - 1]} ${r.ym.slice(0, 4)}`, dep: r.dep, closing: r.nbv }));
}
