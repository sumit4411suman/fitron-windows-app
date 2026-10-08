import { monthsBack } from "./periods";

type Parts = { base: number; commission: number; bonus: number; deductions: number; advance: number };
/** Net pay in paise; negative stays negative (the service rejects it). */
export const netPay = (p: Parts) => p.base + p.commission + p.bonus - p.deductions - p.advance;

/** PT commission: revenue × rate%, rounded to the nearest paisa. */
export const commissionFor = (revenue: number, ratePct: number) => Math.round((revenue * ratePct) / 100);

type Adv = { id: string; amount: number; recovered: number };
export const outstanding = (advances: Adv[]) => advances.reduce((s, a) => s + Math.max(0, a.amount - a.recovered), 0);

/** Takes `amount` back from advances, oldest first (the list must be oldest first). */
export function recoverAdvances(advances: Adv[], amount: number): { id: string; recover: number; settled: boolean }[] {
  let left = amount;
  const out: { id: string; recover: number; settled: boolean }[] = [];
  for (const a of advances) {
    if (left <= 0) break;
    const open = a.amount - a.recovered;
    if (open <= 0) continue;
    const recover = Math.min(open, left);
    left -= recover;
    out.push({ id: a.id, recover, settled: recover === open });
  }
  return out;
}

/** The last 6 months as YYYY-MM, newest first. */
export const payrollMonths = (today: string) => monthsBack(today, 6).reverse();

export const salaryCategory = (roleName: string) => (roleName === "Trainer" ? "trainer-salary" : "staff-salary");

export const salaryLabel = (roleName: string, salaryPaise: number) =>
  roleName === "Super Admin" ? "Owner" : salaryPaise > 0 ? `₹${Math.round(salaryPaise / 100).toLocaleString("en-IN")}/month` : "Not set";
