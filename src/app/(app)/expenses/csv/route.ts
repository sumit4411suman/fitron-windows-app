import { getCurrentUser, PLAN_ENDED } from "@/lib/auth/current";
import { listExpenses } from "@/lib/services/expenses";
import { monthEnd } from "@/lib/domain/periods";
import { toIso } from "@/lib/services/time";

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** "Export CSV" on the Expenses screen: the rows shown, with the prototype's columns. */
export async function GET(req: Request) {
  const u = await getCurrentUser();
  if (!u) return new Response("Sign in first.", { status: 401 });
  if (u.planBlocked) return new Response(PLAN_ENDED, { status: 402 });
  if (!u.can("expenses.manage")) return new Response("Not allowed.", { status: 403 });
  const url = new URL(req.url);
  const month = url.searchParams.get("month") ?? "";
  const range = /^\d{4}-\d{2}$/.test(month) ? { from: `${month}-01`, to: monthEnd(month) } : {};
  const rows = await listExpenses(u, { ...range, categoryId: url.searchParams.get("cat") || undefined });
  const lines = [
    ["Expense", "Date", "Category", "Description", "Vendor", "Method", "Bill no", "Amount"],
    ...rows.map((e) => [e.code, toIso(e.date), e.category.name, e.description, e.vendor, e.method, e.billNo, (e.amount / 100).toFixed(2)]),
  ];
  return new Response("﻿" + lines.map((l) => l.map(cell).join(",")).join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="fitron-expenses${range.from ? `-${month}` : ""}.csv"`, "Cache-Control": "private, no-store" },
  });
}
