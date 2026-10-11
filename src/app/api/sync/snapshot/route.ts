import { snapshotPage } from "@/lib/sync/server";
import { fail, json, withDevice } from "../_lib/http";

// The whole gym, one table and one page at a time (linking, and after a restore).
export const maxDuration = 120;

export async function GET(req: Request) {
  return withDevice(
    req,
    async (dev) => {
      const q = new URL(req.url).searchParams;
      const entity = q.get("entity");
      if (!entity) return fail("Say which table.", 400);
      return json(await snapshotPage(dev, entity, q.get("after")));
    },
    { n: 2000, ms: 60_000 },
  );
}
