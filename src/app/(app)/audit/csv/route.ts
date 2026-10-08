import { getCurrentUser, PLAN_ENDED } from "@/lib/auth/current";
import { listAudit } from "@/lib/services/accounting";
import { toCsv } from "@/lib/services/reports";
import { todayIso } from "@/lib/services/time";
import { addDays } from "@/lib/domain/dates";
import { AUDIT_MODULES, type Severity } from "@/lib/domain/audit";
import { auditTable } from "../table";

/** The audit log with the screen's filters, up to 5,000 entries. */
export async function GET(req: Request) {
  const u = await getCurrentUser();
  if (!u) return new Response("Sign in first.", { status: 401 });
  if (u.planBlocked) return new Response(PLAN_ENDED, { status: 402 });
  if (!u.can("audit.view")) return new Response("Not allowed.", { status: 403 });
  const p = new URL(req.url).searchParams;
  const today = todayIso();
  const range = p.get("range") ?? "30";
  const date = (k: string) => (/^\d{4}-\d{2}-\d{2}$/.test(p.get(k) ?? "") ? p.get(k)! : undefined);
  const from = range === "today" ? today : range === "7" ? addDays(today, -6) : range === "30" ? addDays(today, -29) : range === "custom" ? date("from") : undefined;
  const sev = ["High", "Medium", "Low"].includes(p.get("sev") ?? "") ? (p.get("sev") as Severity) : undefined;
  const mod = AUDIT_MODULES.includes(p.get("mod") ?? "") ? p.get("mod")! : undefined;
  const { rows } = await listAudit(u, { q: p.get("q") ?? undefined, userId: p.get("user") ?? undefined, module: mod, severity: sev, from, to: range === "custom" ? date("to") : undefined, pageSize: 5000 });
  const csv = toCsv(auditTable(rows));
  return new Response("﻿" + csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="audit-log_${today}.csv"`, "Cache-Control": "private, no-store" } });
}
