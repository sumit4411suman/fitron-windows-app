import { getCurrentUser, PLAN_ENDED } from "@/lib/auth/current";
import { canUsePermission } from "@/lib/domain/features";
import { LEDGERS, ledgerTable, profitAndLoss, type LedgerKind } from "@/lib/services/accounting";
import { toIso } from "@/lib/services/time";

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const rupees = (paise: number) => (paise / 100).toFixed(2);
const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** CSV downloads for Accounting: the P&L for a period (kind=pl) or one of the four ledgers. */
export async function GET(req: Request) {
  const u = await getCurrentUser();
  if (!u) return new Response("Sign in first.", { status: 401 });
  if (u.planBlocked) return new Response(PLAN_ENDED, { status: 402 });
  if (!canUsePermission(u, "accounting.view")) return new Response("Not allowed.", { status: 403 });
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ?? "";
  let lines: unknown[][];
  let name: string;
  if (kind === "pl") {
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (!isDate(from) || !isDate(to)) return new Response("Pick a period.", { status: 400 });
    const pl = await profitAndLoss(u, { from, to });
    const exp = pl.totalExpenses + pl.depreciation + pl.disposalLoss;
    lines = [
      ["Line", "Amount"],
      ...pl.revenue.map((r) => [r.key, rupees(r.amount)]),
      ...(pl.disposalGain ? [["Gain on sale of assets", rupees(pl.disposalGain)]] : []),
      ["Total revenue", rupees(pl.totalRevenue + pl.disposalGain)],
      ...pl.expenseGroups.map((r) => [r.key, rupees(r.amount)]),
      ...(pl.depreciation ? [["Depreciation", rupees(pl.depreciation)]] : []),
      ...(pl.disposalLoss ? [["Loss on disposal of assets", rupees(pl.disposalLoss)]] : []),
      ["Total expenses", rupees(exp)],
      ["Net", rupees(pl.net)],
    ];
    name = `fitron-pl_${from}_${to}.csv`;
  } else if ((LEDGERS as readonly string[]).includes(kind)) {
    const t = await ledgerTable(u, kind as LedgerKind);
    lines = [t.cols, ...t.rows.map((r) => r.map((v, i) => (v instanceof Date ? toIso(v) : t.money.includes(i) ? rupees(v as number) : v)))];
    name = `fitron-${kind}-ledger.csv`;
  } else return new Response("Not found.", { status: 404 });
  return new Response("﻿" + lines.map((l) => l.map(cell).join(",")).join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" },
  });
}
