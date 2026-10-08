import { log } from "@/lib/log";
import { rateLimit } from "@/lib/rate-limit";

// Where the browser reports an error page it showed (src/lib/client-error.ts). Open to everyone, since the error can
// happen on a public page, so it is small and limited: 4 KB, 20 reports per 10 minutes per address, and it only writes
// one log line. Server errors don't come here: they reach the log through src/instrumentation.ts.
const WHERE = new Set(["page", "app", "global"]);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!rateLimit(`client-error:${ip}`, 20, 10 * 60_000)) return new Response(null, { status: 429 });
  const raw = await req.text().catch(() => "");
  if (raw.length > 4_096) return new Response(null, { status: 413 });
  let b: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) b = parsed as Record<string, unknown>;
  } catch {
    return new Response(null, { status: 400 });
  }
  log.warn("client.error", undefined, {
    where: typeof b.where === "string" && WHERE.has(b.where) ? b.where : "page",
    message: text(b.message, 300),
    at: text(b.at, 200),
    digest: text(b.digest, 64),
    path: text(b.path, 200)?.split("?")[0],
    userAgent: req.headers.get("user-agent")?.slice(0, 120),
  });
  return new Response(null, { status: 204 });
}
