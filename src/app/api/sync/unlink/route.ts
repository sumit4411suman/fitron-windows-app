import { revokeDevice } from "@/lib/sync/server";
import { json, withDevice } from "../_lib/http";

// The computer unlinking itself (Settings › Cloud sync › Unlink this computer).
export async function POST(req: Request) {
  return withDevice(req, async (dev) => {
    await revokeDevice(dev.orgId, dev.linkedById, dev.id);
    return json({ ok: true });
  });
}
