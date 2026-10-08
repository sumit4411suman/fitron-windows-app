import { publicContent } from "@/lib/services/trainer-content";
import { log } from "@/lib/log";

/** Exercise form videos, for every visitor of the app (nothing personal in it). */
export async function GET() {
  try {
    return Response.json({ videos: await publicContent() }, { headers: { "cache-control": "public, max-age=300" } });
  } catch (e) {
    log.error("trainer_content.failed", e);
    return Response.json({ videos: {} }, { status: 500 });
  }
}
