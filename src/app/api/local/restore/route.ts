import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getCurrentUser } from "@/lib/auth/current";
import { isLocal } from "@/lib/runtime/edition";
import { dataDirs } from "@/lib/runtime/paths";
import { UserError } from "@/lib/services/errors";
import { localRestore } from "@/lib/services/local-backup";

export const maxDuration = 900;
const MAX_BYTES = 8 * 1024 ** 3;

/**
 * Restore from a file chosen on this computer (Local Edition, Super Admin). The browser sends the file as the request
 * body, streamed straight to the data folder, so a large backup is never held in memory. The password and the typed
 * RESTORE come in headers. Only from FITRON's own page: the request must come from the same origin.
 */
export async function POST(req: Request) {
  if (!isLocal()) return Response.json({ error: "Not found" }, { status: 404 });
  const origin = req.headers.get("origin");
  // Same origin as the page the person is on: the Host the browser sent (Next's own URL may name another address).
  if (!origin || new URL(origin).host !== req.headers.get("host")) return Response.json({ error: "Refused: the restore must come from FITRON's own Backup page." }, { status: 403 });
  const u = await getCurrentUser();
  if (!u) return Response.json({ error: "Sign in again." }, { status: 401 });
  if (!req.body) return Response.json({ error: "Choose a backup file." }, { status: 400 });
  const size = Number(req.headers.get("content-length") ?? 0);
  if (size > MAX_BYTES) return Response.json({ error: "That file is too large to be a FITRON backup." }, { status: 413 });

  const upload = path.join(dataDirs().root, `restore-upload-${randomBytes(6).toString("hex")}.fitronbackup`);
  try {
    await pipeline(Readable.fromWeb(req.body as import("node:stream/web").ReadableStream), createWriteStream(upload, { mode: 0o600 }));
    const r = await localRestore(u, {
      file: upload,
      password: decodeURIComponent(req.headers.get("x-fitron-password") ?? ""),
      confirm: req.headers.get("x-fitron-confirm") ?? "",
      label: decodeURIComponent(req.headers.get("x-fitron-filename") ?? "uploaded file").slice(0, 120),
    });
    return Response.json({ ok: true, redirect: `/login?restored=${encodeURIComponent(r.manifest.createdAt)}` });
  } catch (e) {
    if (e instanceof UserError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  } finally {
    await rm(upload, { force: true });
  }
}
