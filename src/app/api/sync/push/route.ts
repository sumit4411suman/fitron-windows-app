import { pushBatch } from "@/lib/sync/server";
import { PUSH_LIMIT, type PushItem } from "@/lib/sync/protocol";
import { fail, json, readJson, withDevice } from "../_lib/http";

// A batch of the computer's changes, each answered applied, conflict or rejected. Long: up to PUSH_LIMIT transactions.
export const maxDuration = 300;

export async function POST(req: Request) {
  return withDevice(req, async (dev) => {
    const body = await readJson<{ items?: PushItem[] }>(req);
    if (!body || !Array.isArray(body.items) || body.items.length > PUSH_LIMIT) return fail(`Send between 1 and ${PUSH_LIMIT} changes as {"items": [...]}.`, 400);
    return json({ results: await pushBatch(dev, body.items) });
  });
}
