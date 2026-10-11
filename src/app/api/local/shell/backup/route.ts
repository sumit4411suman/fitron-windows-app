import { timingSafeEqual } from "node:crypto";
import { createLocalBackup } from "@/lib/runtime/fitron-backup";
import { isLocal } from "@/lib/runtime/edition";
import { dataDirs } from "@/lib/runtime/paths";
import { log } from "@/lib/log";

export const maxDuration = 900;

/**
 * The desktop shell's own request for a safety backup of the gym's data, before it installs an update (Phase 18,
 * src-tauri/src/update.rs). Only the shell can ask: it must send the secret it gave this server when it started it
 * (FITRON_SHELL_TOKEN), which no page ever sees. Nothing else is accepted on this address.
 */
export async function POST(req: Request) {
  if (!isLocal()) return Response.json({ ok: false, error: "Not found" }, { status: 404 });
  const expected = process.env.FITRON_SHELL_TOKEN ?? "";
  const given = req.headers.get("x-fitron-shell") ?? "";
  if (!expected || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return Response.json({ ok: false, error: "Not allowed" }, { status: 403 });
  }
  let reason = "Before an update";
  try {
    const body = (await req.json()) as { reason?: unknown };
    if (typeof body.reason === "string" && body.reason.trim()) reason = body.reason.trim().slice(0, 200);
  } catch {
    // No body: the default reason.
  }
  try {
    const b = await createLocalBackup({ dirs: dataDirs(), kind: "safety", appVersion: process.env.APP_VERSION ?? "0.0.0", note: reason });
    log.info("local.backup.before_update", { name: b.name, size: b.size });
    return Response.json({ ok: true, name: b.name, size: b.size });
  } catch (e) {
    log.error("local.backup.before_update_failed", e);
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
