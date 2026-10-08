import { getCurrentUser } from "@/lib/auth/current";
import { readGymLogo } from "@/lib/services/gym-logo";

// The gym's logo is private: streamed only to people signed in to that gym (it is in every sidebar,
// so a lapsed plan still gets it).
export async function GET() {
  const u = await getCurrentUser();
  if (!u) return new Response("Sign in again.", { status: 401 });
  const r = await readGymLogo(u.orgId);
  if (!r) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(r.body), {
    headers: {
      "Content-Type": r.mime,
      // The URL carries the logo's key, so a new logo gets a new URL.
      "Cache-Control": "private, max-age=86400",
      "Content-Security-Policy": "sandbox; default-src 'none'",
    },
  });
}
