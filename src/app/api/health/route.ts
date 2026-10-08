import { db } from "@/lib/db";

// Uptime checks and Docker call this. 200 when the app and its database answer.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, error: "Database unreachable" }, { status: 503 });
  }
}
