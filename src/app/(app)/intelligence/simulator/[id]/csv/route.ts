import { getCurrentUser, PLAN_ENDED } from "@/lib/auth/current";
import { canUsePermission } from "@/lib/domain/features";
import { parseInputs } from "@/lib/domain/simulator";
import { getScenario, scenarioReportRows, scenarioResult } from "@/lib/services/simulator";
import { UserError } from "@/lib/services/errors";

/** The scenario report as a CSV: assumptions first, then the month-by-month forecast. Rupees, not paise. */
export async function GET(_req: Request, ctx: RouteContext<"/intelligence/simulator/[id]/csv">) {
  const u = await getCurrentUser();
  if (!u) return new Response("Sign in first.", { status: 401 });
  if (u.planBlocked) return new Response(PLAN_ENDED, { status: 402 });
  if (!canUsePermission(u, "accounting.view")) return new Response("Not allowed.", { status: 403 });
  const { id } = await ctx.params;
  let s;
  try {
    s = await getScenario(u, id);
  } catch (e) {
    if (e instanceof UserError) return new Response("Not found", { status: 404 });
    throw e;
  }
  const rep = scenarioReportRows(s, parseInputs(s.inputs), scenarioResult(s).result);
  const cell = (v: unknown) => {
    const t = String(v ?? "");
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const lines = [...rep.assumptions.map((r) => r.map(cell).join(",")), "", rep.columns.map(cell).join(","), ...rep.rows.map((r) => r.map(cell).join(","))];
  const name = `scenario-${s.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
  return new Response(`﻿${lines.join("\r\n")}`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"` } });
}
