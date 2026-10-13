import { answerDevice, type DeviceAnswer } from "@/lib/services/device-calls";

// ZKTeco / eSSL devices in ADMS ("cloud server") mode call these URLs. On the device set
// Server address = your Fitron domain, port 443 (or 80), and turn on HTTPS if the model supports it.
// What each call gets is in src/lib/services/device-calls.ts, shared with FITRON for Windows' device port.

const text = (a: DeviceAnswer) => new Response(a.body, { status: a.status, headers: { "Content-Type": "text/plain" } });

/** One device call: /iclock/<endpoint>?SN=…, answered as a device expects. */
export async function answerRequest(req: Request, endpoint: string) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const body = req.method === "POST" ? await req.text() : "";
  return text(await answerDevice({ endpoint, method: req.method, params: new URL(req.url).searchParams, ip, body }));
}
