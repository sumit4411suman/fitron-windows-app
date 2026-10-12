import { notInLocal } from "@/lib/runtime/not-in-local";
import { rateLimit } from "@/lib/rate-limit";
import { claimWindowsLicence } from "@/lib/services/windows-licence";
import { log } from "@/lib/log";

// fitron.in: a FITRON for Windows computer collects the licence it bought (src/lib/licence/purchase.ts). It sends its
// installation id and the one-time claim from its Buy button, nothing else; the answer is the signed licence once paid.
export async function POST(req: Request) {
  const off = notInLocal();
  if (off) return off;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!rateLimit(`windows-claim:${ip}`, 120, 10 * 60_000)) return Response.json({ error: "Too many requests. FITRON tries again later by itself." }, { status: 429 });
  let body: { installationId?: unknown; claim?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  try {
    return Response.json(await claimWindowsLicence(body), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    log.error("windows_licence.claim", e);
    return Response.json({ error: "fitron.in could not answer just now. FITRON tries again later by itself." }, { status: 500 });
  }
}
