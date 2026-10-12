import { getCurrentUser } from "@/lib/auth/current";
import { isLocal } from "@/lib/runtime/edition";
import { readState, syncCounts } from "@/lib/sync/client";
import { workerStatus } from "@/lib/sync/worker";

// The header's cloud-sync badge on FITRON for Windows: counts and times only, never record contents.
export async function GET() {
  if (!isLocal()) return new Response("Not found", { status: 404 });
  if (!(await getCurrentUser())) return Response.json({ error: "Sign in again." }, { status: 401 });
  const s = await readState();
  if (!s?.linked) return Response.json({ linked: false }, { headers: { "cache-control": "no-store" } });
  const [c, w] = [await syncCounts(), workerStatus()];
  return Response.json(
    { linked: true, pending: c.pending, failed: c.failed, conflicts: c.conflicts, appliedSeq: Number(s.appliedSeq), lastOkAt: s.lastOkAt, error: w.revoked ? "unlinked" : s.lastError ? "offline" : null, running: w.running },
    { headers: { "cache-control": "no-store" } },
  );
}
