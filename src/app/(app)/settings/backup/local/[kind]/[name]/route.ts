import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { getCurrentUser } from "@/lib/auth/current";
import { isLocal } from "@/lib/runtime/edition";
import { backupPath } from "@/lib/runtime/fitron-backup";
import { db } from "@/lib/db";
import { audit } from "@/lib/services/audit";

// Downloads a .fitronbackup (Local Edition, Super Admin): to keep a copy on a pen drive or another computer.
export async function GET(_req: Request, ctx: RouteContext<"/settings/backup/local/[kind]/[name]">) {
  if (!isLocal()) return new Response("Not found", { status: 404 });
  const u = await getCurrentUser();
  if (!u) return new Response("Sign in again.", { status: 401 });
  if (u.role !== "Super Admin") return new Response("Only a Super Admin can download a backup.", { status: 403 });
  const { kind, name } = await ctx.params;
  const file = backupPath(kind, decodeURIComponent(name));
  if (!file) return new Response("Not found", { status: 404 });
  const { size } = await stat(file);
  await db.$transaction((tx) => audit(tx, { orgId: u.orgId, userId: u.id, action: "backup.local.download", entity: "Backup", entityId: name }));
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
