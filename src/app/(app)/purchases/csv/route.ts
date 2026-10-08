import { getCurrentUser, PLAN_ENDED } from "@/lib/auth/current";
import { canUsePermission } from "@/lib/domain/features";
import { listPurchases } from "@/lib/services/purchases";
import { toIso } from "@/lib/services/time";

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const rupees = (paise: number) => (paise / 100).toFixed(2);
const KIND: Record<string, string> = { STOCK: "Stock", ASSET: "Asset", EXPENSE: "Expense" };

/** Purchases CSV, one row per bill line, as in the prototype. */
export async function GET(req: Request) {
  const u = await getCurrentUser();
  if (!u) return new Response("Sign in first.", { status: 401 });
  if (u.planBlocked) return new Response(PLAN_ENDED, { status: 402 });
  if (!canUsePermission(u, "purchases.manage")) return new Response("Not allowed.", { status: 403 });
  const month = new URL(req.url).searchParams.get("month") ?? "";
  const rows = (await listPurchases(u, {})).filter((p) => !/^\d{4}-\d{2}$/.test(month) || toIso(p.date).startsWith(month));
  const lines = [
    ["Purchase", "Date", "Vendor", "Bill", "Type", "Item", "Qty", "Rate", "GST %", "Amount", "Bill total", "Paid", "Balance"],
    ...rows.flatMap((p) => p.lines.map((l) => [p.code, toIso(p.date), p.vendor, p.billNo, KIND[l.type] ?? l.type, l.description, l.qty, rupees(l.rate), String(l.gstPct), rupees(l.amount), rupees(p.total), rupees(p.paid), rupees(p.balance)])),
  ];
  return new Response("﻿" + lines.map((l) => l.map(cell).join(",")).join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="fitron-purchases${month ? `-${month}` : ""}.csv"`, "Cache-Control": "private, no-store" },
  });
}
