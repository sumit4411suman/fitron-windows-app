import { getCurrentUser } from "@/lib/auth/current";
import { readProfilePhoto } from "@/lib/services/profile";

// Staff photos are private: streamed only to people signed in to the same gym.
export async function GET(_: Request, ctx: RouteContext<"/profile/photo/[id]">) {
  const u = await getCurrentUser();
  if (!u) return new Response("Sign in again.", { status: 401 });
  const { id } = await ctx.params;
  const r = await readProfilePhoto(u, id);
  if (!r) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(r.body), {
    headers: {
      "Content-Type": r.mime,
      // The URL carries the photo's key, so a new photo gets a new URL.
      "Cache-Control": "private, max-age=86400",
      "Content-Security-Policy": "sandbox; default-src 'none'",
    },
  });
}
