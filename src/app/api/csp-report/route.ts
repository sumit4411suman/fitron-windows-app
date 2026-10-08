import { log } from "@/lib/log";
import { rateLimit } from "@/lib/rate-limit";

// Where browsers report what the Content-Security-Policy (src/lib/csp.ts) blocked, or in report-only mode would have
// blocked. Open to everyone, so it is limited: 8 KB, 60 reports per address and 600 in all per 10 minutes, and the same
// violation on the same page is logged once per 10 minutes, with a count of the repeats. Read them with
// `docker compose logs app | grep csp.violation`.
const WINDOW = 10 * 60_000;
const seen = new Map<string, { at: number; repeats: number }>();

/** Only where a thing is from, never what it holds: http(s) addresses lose their query and fragment; the rest are kept as a keyword. */
const place = (v: unknown): string | undefined => {
  if (typeof v !== "string" || !v) return undefined;
  if (/^https?:\/\//i.test(v)) {
    try {
      const u = new URL(v);
      return `${u.origin}${u.pathname}`.slice(0, 200);
    } catch {
      return undefined;
    }
  }
  return v.split(":")[0]!.slice(0, 20);
};
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!rateLimit(`csp-report:${ip}`, 60, WINDOW) || !rateLimit("csp-report:all", 600, WINDOW)) return new Response(null, { status: 429 });
  const raw = await req.text().catch(() => "");
  if (raw.length > 8_192) return new Response(null, { status: 413 });
  let report: Record<string, unknown> = {};
  try {
    const body: unknown = JSON.parse(raw);
    // "application/csp-report" wraps it as {"csp-report": {...}}; "application/reports+json" is a list of {type, body}.
    const first = Array.isArray(body) ? (body[0] as { body?: unknown } | undefined)?.body : (body as { "csp-report"?: unknown })?.["csp-report"];
    if (typeof first === "object" && first !== null) report = first as Record<string, unknown>;
  } catch {
    return new Response(null, { status: 400 });
  }
  const directive = text(report["effective-directive"] ?? report["violated-directive"] ?? report.effectiveDirective, 60);
  const blocked = place(report["blocked-uri"] ?? report.blockedURL);
  const pageUrl = place(report["document-uri"] ?? report.documentURL);
  const page = pageUrl ? new URL(pageUrl, "http://x").pathname : undefined;
  if (!directive) return new Response(null, { status: 204 });

  const key = `${directive}|${blocked}|${page}`;
  const now = Date.now();
  const prev = seen.get(key);
  if (prev && now - prev.at < WINDOW) {
    prev.repeats += 1;
    return new Response(null, { status: 204 });
  }
  seen.delete(key);
  seen.set(key, { at: now, repeats: 0 });
  if (seen.size > 500) seen.delete(seen.keys().next().value!);
  log.warn("csp.violation", undefined, {
    directive,
    blocked,
    page,
    source: place(report["source-file"] ?? report.sourceFile),
    line: typeof (report["line-number"] ?? report.lineNumber) === "number" ? ((report["line-number"] ?? report.lineNumber) as number) : undefined,
    disposition: text(report.disposition, 10),
    repeatsBefore: prev ? prev.repeats : undefined,
  });
  return new Response(null, { status: 204 });
}
