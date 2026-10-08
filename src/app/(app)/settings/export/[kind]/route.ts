import { getCurrentUser, PLAN_ENDED } from "@/lib/auth/current";
import { EXPORTS, exportAll, isExportKind } from "@/lib/services/exports";

/** Settings → Migrate & import → Export all data: every record of the visible branches as CSV. */
export async function GET(_req: Request, ctx: RouteContext<"/settings/export/[kind]">) {
  const u = await getCurrentUser();
  if (!u) return new Response("Sign in first.", { status: 401 });
  if (u.planBlocked) return new Response(PLAN_ENDED, { status: 402 });
  const { kind } = await ctx.params;
  if (!isExportKind(kind)) return new Response("Not found.", { status: 404 });
  if (!u.can("import.run") || !u.can(EXPORTS[kind].perm)) return new Response("Not allowed.", { status: 403 });
  const { fileName, csv } = await exportAll(u, kind);
  return new Response("﻿" + csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${fileName}"`, "Cache-Control": "private, no-store" } });
}
