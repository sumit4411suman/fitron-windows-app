import { db } from "@/lib/db";
import { edition } from "@/lib/runtime/edition";

export const dynamic = "force-dynamic";

// Liveness for the load balancer (Cloud) and for the desktop shell (Local), which waits for `ok: true` before it shows
// the window. The Local Edition is ready only once its migrations ran (src/lib/runtime/local-start.ts). Nothing here
// names a gym or a person. `instance` is the id the desktop shell gave the server it started, so the shell knows the
// answer came from its own server and not from another program that took the port.
export async function GET() {
  const body = { edition: edition(), version: process.env.APP_VERSION ?? "0.0.0", ...(process.env.FITRON_INSTANCE ? { instance: process.env.FITRON_INSTANCE } : {}) };
  if (body.edition === "local") {
    const { localStartState } = await import("@/lib/runtime/local-start");
    const { localStopping } = await import("@/lib/runtime/local-shutdown");
    const start = localStartState();
    if (localStopping()) return Response.json({ ok: false, ...body, error: "Stopping" }, { status: 503 });
    if (!start?.ready) return Response.json({ ok: false, ...body, error: start?.error ? "Database migration failed" : "Starting" }, { status: 503 });
  }
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ ok: true, ...body });
  } catch {
    return Response.json({ ok: false, ...body, error: "Database unreachable" }, { status: 503 });
  }
}
