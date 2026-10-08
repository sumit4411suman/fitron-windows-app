import { getCurrentUser } from "@/lib/auth/current";
import { readBackup } from "@/lib/services/backup";

/** Settings › Backup › Download: the backup file. A gym whose plan lapsed may still take its data. */
export async function GET(_req: Request, ctx: RouteContext<"/settings/backup/[id]/download">) {
  const u = await getCurrentUser();
  if (!u) return new Response("Sign in first.", { status: 401 });
  if (!u.can("settings.manage")) return new Response("Not allowed.", { status: 403 });
  const { id } = await ctx.params;
  const r = await readBackup(u, id);
  if (!r) return new Response("Not found.", { status: 404 });
  return new Response(Buffer.from(r.body), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${r.backup.fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
