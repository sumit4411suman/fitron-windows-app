import { getCurrentUser, PLAN_ENDED } from "@/lib/auth/current";
import { REPORTS, toXlsx } from "@/lib/services/reports";
import { XLSX_MIME } from "@/lib/xlsx";
import { monthPeriod } from "@/lib/services/accounting";
import { todayIso } from "@/lib/services/time";

const isDate = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function GET(req: Request, ctx: RouteContext<"/reports/[key]/xls">) {
  const u = await getCurrentUser();
  if (!u) return new Response("Sign in first.", { status: 401 });
  if (u.planBlocked) return new Response(PLAN_ENDED, { status: 402 });
  const { key } = await ctx.params;
  const def = REPORTS[key];
  if (!def) return new Response("Not found.", { status: 404 });
  // The same two checks as the CSV route: the role, and the plan that opens this report.
  if (!u.can(def.perm) || (def.feature && !u.has(def.feature))) return new Response("Not allowed.", { status: 403 });
  const url = new URL(req.url);
  const today = todayIso();
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const period = { from: isDate(from) ? from! : monthPeriod(today.slice(0, 7)).from, to: isDate(to) ? to! : today };
  return new Response(toXlsx(def.title, await def.run(u, period)) as BodyInit, {
    headers: { "Content-Type": XLSX_MIME, "Content-Disposition": `attachment; filename="fitron-${key}.xlsx"`, "Cache-Control": "private, no-store" },
  });
}
