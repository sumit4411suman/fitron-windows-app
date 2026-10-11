import { getCurrentUser } from "@/lib/auth/current";
import { globalSearch } from "@/lib/services/shell";
import { limitSearch, TOO_MANY_SEARCHES } from "@/lib/rate-limit";

// The header search box asks here as you type.
export async function GET(req: Request) {
  const u = await getCurrentUser();
  if (!u) return Response.json({ results: [] }, { status: 401 });
  if (u.planBlocked) return Response.json({ results: [] }, { status: 402 });
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const results = await limitSearch(u.id, () => globalSearch(u, q.slice(0, 100)));
  if (results === null) return Response.json({ results: [], error: TOO_MANY_SEARCHES }, { status: 429, headers: { "Retry-After": "5" } });
  return Response.json({ results }, { headers: { "Cache-Control": "private, no-store" } });
}
