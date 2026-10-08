import { deviceFor } from "@/lib/services/biometric";

// ZKTeco / eSSL devices in ADMS ("cloud server") mode call these URLs. On the device set
// Server address = your Fitron domain, port 443 (or 80), and turn on HTTPS if the model supports it.
// Devices can't sign requests, so a new serial is only recorded; a Super Admin approves it in
// Settings → Devices before anything it sends is used.

export const text = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/plain" } });

export async function device(req: Request) {
  const sn = new URL(req.url).searchParams.get("SN") ?? "";
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  return { sn, d: await deviceFor(sn, ip) };
}
