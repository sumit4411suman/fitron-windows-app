import type { Sheet } from "@/lib/xlsx";
import { addMonths, type IsoDate } from "./dates";
import { monthLabel } from "./periods";
import { rupeesLabel } from "./pricing";

// The monthly profit-and-loss email: which month it covers, when it goes out, what it says and the sheet it carries.

/** The figures of the month, in paise: what accounting.profitAndLoss returns. */
export type MonthlyPl = {
  revenue: { key: string; amount: number }[];
  expenseGroups: { key: string; amount: number }[];
  totalRevenue: number;
  totalExpenses: number;
  depreciation: number;
  disposalGain: number;
  disposalLoss: number;
  net: number;
  gstCollected: number;
  collected: number;
};

/** The days of the month on which the email may go out. The first is the day; the next two are for a retry after a failure. */
export const SEND_DAYS = 3;

/** "2026-10-01" → "2026-09": the month the email covers. Null when it is not one of the days it goes out. */
export function monthToReport(today: IsoDate): string | null {
  if (Number(today.slice(8, 10)) > SEND_DAYS) return null;
  return addMonths(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
}

const margin = (net: number, revenue: number) => (revenue > 0 ? `${Math.round((net / revenue) * 100)}%` : null);
const signed = (paise: number) => (paise < 0 ? `-${rupeesLabel(-paise)}` : rupeesLabel(paise));
const firstName = (name: string) => name.trim().split(/\s+/)[0] || "there";

/** The lines of a list that matter: the biggest few, with the rest folded into "Other". */
function top(lines: { key: string; amount: number }[], n = 3) {
  const sorted = lines.filter((l) => l.amount !== 0).sort((a, b) => b.amount - a.amount);
  const shown = sorted.slice(0, n);
  const rest = sorted.slice(n).reduce((s, l) => s + l.amount, 0);
  return rest ? [...shown, { key: "Other", amount: rest }] : shown;
}

export function plEmail(o: { gym: string; month: string; name: string; pl: MonthlyPl; settingsUrl: string }) {
  const { pl } = o;
  const label = monthLabel(o.month);
  const m = pl.net >= 0 ? margin(pl.net, pl.totalRevenue) : null; // a loss is already a minus sign; a percentage of it adds nothing
  // Mail programs show plain text in any font, so lines are "label: amount" rather than columns.
  const row = (k: string, v: string) => `${k}: ${v}`;
  const list = (lines: { key: string; amount: number }[]) => top(lines).map((l) => `   - ${row(l.key, rupeesLabel(l.amount))}`);
  const text = [
    `Hello ${firstName(o.name)},`,
    "",
    `Here is how ${o.gym} did in ${label}.`,
    "",
    row("Revenue", rupeesLabel(pl.totalRevenue)),
    ...list(pl.revenue),
    row("Operating expenses", rupeesLabel(pl.totalExpenses)),
    ...list(pl.expenseGroups),
    ...(pl.depreciation ? [row("Depreciation", rupeesLabel(pl.depreciation))] : []),
    ...(pl.disposalGain ? [row("Gain on asset sales", rupeesLabel(pl.disposalGain))] : []),
    ...(pl.disposalLoss ? [row("Loss on asset sales", rupeesLabel(pl.disposalLoss))] : []),
    row(pl.net < 0 ? "Net loss" : "Net profit", signed(pl.net) + (m ? `  (${m} of revenue)` : "")),
    "",
    `Money received in the month: ${rupeesLabel(pl.collected)}`,
    ...(pl.gstCollected ? [`GST on your sales: ${rupeesLabel(pl.gstCollected)} (not counted in revenue)`] : []),
    "",
    "The full statement is attached as an Excel file. Revenue is what you billed in the month, before GST; the money received is what members actually paid in it.",
    "",
    `Do not want this email? Switch it off in Settings › Reminders: ${o.settingsUrl}`,
    "",
    "FITRON",
  ].join("\n");
  return { subject: `${o.gym}: profit and loss for ${label}`, text };
}

/** The statement as a sheet: each line of revenue and of expense, then the result. Amounts are paise. */
export function plSheet(month: string, pl: MonthlyPl): Sheet {
  const lines = (section: string, ls: { key: string; amount: number }[]): [string, string, number][] => [...ls].sort((a, b) => b.amount - a.amount).map((l) => [section, l.key, l.amount]);
  // The three adjustments appear only when they are not nil; GST and money received are shown for reference, not part of the profit.
  const adjust = (label: string, amount: number): [string, string, number][] => (amount ? [["Adjustments", label, amount]] : []);
  const rows: Sheet["rows"] = [
    ...lines("Revenue", pl.revenue),
    ["Revenue", "Total revenue", pl.totalRevenue],
    ...lines("Operating expenses", pl.expenseGroups),
    ["Operating expenses", "Total operating expenses", pl.totalExpenses],
    ...adjust("Less: depreciation", pl.depreciation),
    ...adjust("Add: gain on asset sales", pl.disposalGain),
    ...adjust("Less: loss on asset sales", pl.disposalLoss),
    ["Not part of the profit", "GST collected on sales", pl.gstCollected],
    ["Not part of the profit", "Money received in the month", pl.collected],
  ];
  return { name: `P&L ${monthLabel(month)}`, columns: [{ label: "Section" }, { label: "Line" }, { label: "Amount (₹)", kind: "money" }], rows, totals: [pl.net < 0 ? "Net loss" : "Net profit", null, pl.net] };
}
