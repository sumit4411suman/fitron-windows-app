import { changesSince } from "@/lib/sync/server";
import { json, withDevice } from "../_lib/http";

// The gym's changes after `since`, oldest first, a page at a time.
export async function GET(req: Request) {
  return withDevice(req, async (dev) => {
    const q = new URL(req.url).searchParams;
    const since = Math.max(0, Number(q.get("since") ?? 0) || 0);
    const limit = Number(q.get("limit") ?? 0) || undefined;
    const resynced = q.get("resynced") ? new Date(q.get("resynced")!) : undefined;
    return json(await changesSince(dev, since, limit, resynced && !Number.isNaN(resynced.getTime()) ? resynced : undefined));
  });
}
