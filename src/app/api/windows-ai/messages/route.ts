import { notInLocal } from "@/lib/runtime/not-in-local";
import { relayWindowsAi } from "@/lib/services/windows-ai";
import { readCapped } from "../../trainer/_lib/http";
import { log } from "@/lib/log";

// fitron.in: Fitron AI for a FITRON for Windows computer with a current licence (src/lib/services/windows-ai.ts). The
// licence comes in x-fitron-licence; the body is the Claude request the computer built. Nothing of it is kept or logged.
export const maxDuration = 120;

export async function POST(req: Request) {
  const off = notInLocal();
  if (off) return off;
  const raw = await readCapped(req, 4_400_000);
  if (raw === null) return Response.json({ error: "Too big." }, { status: 413 });
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {}
  try {
    const out = await relayWindowsAi(req.headers.get("x-fitron-licence"), json);
    if (!out.ok) return Response.json({ error: out.error }, { status: out.status, headers: { "cache-control": "no-store" } });
    return Response.json(out.reply, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    // The error, never the question: Claude's own error text has no gym data in it.
    log.error("windows_ai.failed", e instanceof Error ? new Error(e.message.slice(0, 200)) : e);
    return Response.json({ error: "Fitron AI couldn't answer just now." }, { status: 502 });
  }
}
