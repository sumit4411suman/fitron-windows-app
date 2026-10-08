import { getCurrentUser } from "@/lib/auth/current";
import { readMemberPhoto } from "@/lib/services/members";

// Member photos are private: streamed only to staff who may open that member.
export async function GET(_: Request, ctx: RouteContext<"/members/[id]/photo">) {
  const u = await getCurrentUser();
  if (!u) return new Response("Sign in again.", { status: 401 });
  if (u.planBlocked) return new Response("PLAN_ENDED", { status: 402 });
  if (!u.can("members.view")) return new Response("Not allowed", { status: 403 });
  const { id } = await ctx.params;
  const r = await readMemberPhoto(u, id);
  if (!r) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(r.body), {
    headers: {
      "Content-Type": r.mime,
      "Cache-Control": "private, max-age=86400",
      "Content-Security-Policy": "sandbox; default-src 'none'",
    },
  });
}
