import "server-only";
import { getCurrentUser, PLAN_ENDED, type CurrentUser } from "@/lib/auth/current";
import { AI_OFF_MESSAGE, aiOn } from "@/lib/services/ai-settings";

/** The signed-in person if they may use Fitron AI now, or the answer to send instead (shared by the chat routes). */
export async function aiUser(): Promise<CurrentUser | Response> {
  const u = await getCurrentUser();
  if (!u) return Response.json({ error: "Sign in again." }, { status: 401 });
  if (u.planBlocked) return Response.json({ error: PLAN_ENDED }, { status: 402 });
  if (!u.has("ai")) return Response.json({ error: "Fitron AI is on the Professional plan. A Super Admin can upgrade in Settings › Plan & billing." }, { status: 402 });
  if (!u.can("ai.use")) return Response.json({ error: "Your role doesn't include Fitron AI." }, { status: 403 });
  if (!(await aiOn(u.orgId))) return Response.json({ error: AI_OFF_MESSAGE }, { status: 403 });
  return u;
}
