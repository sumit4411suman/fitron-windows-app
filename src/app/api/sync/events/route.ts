import { latestSeq } from "@/lib/sync/server";
import { withDevice } from "../_lib/http";

// Server-Sent Events: one line per new change number of the gym, so a linked computer downloads within seconds instead of
// waiting for its next poll. The stream ends after a few minutes (hosts bound a response's life); the computer
// reconnects from the number it has. A comment every 15 seconds keeps proxies from closing a quiet connection.
export const maxDuration = 300;

const LIFE_MS = 270_000;
const CHECK_MS = 2_000;
const BEAT_MS = 15_000;

export async function GET(req: Request) {
  return withDevice(
    req,
    async (dev) => {
      let last = Math.max(0, Number(new URL(req.url).searchParams.get("since") ?? 0) || 0);
      const enc = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(ctrl) {
          const end = Date.now() + LIFE_MS;
          let beat = Date.now();
          const send = (s: string) => ctrl.enqueue(enc.encode(s));
          send(`retry: 5000\n\n`);
          try {
            while (Date.now() < end && !req.signal.aborted) {
              const seq = await latestSeq(dev.orgId);
              if (seq > last) {
                last = seq;
                send(`event: change\ndata: ${seq}\n\n`);
                beat = Date.now();
              } else if (Date.now() - beat > BEAT_MS) {
                send(`: still here\n\n`);
                beat = Date.now();
              }
              await new Promise((r) => setTimeout(r, CHECK_MS));
            }
          } catch {
            // The computer reconnects.
          }
          ctrl.close();
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store, no-transform", "x-accel-buffering": "no" } });
    },
    { n: 120, ms: 60_000 },
  );
}
