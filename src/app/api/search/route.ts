import { getCurrentUser } from "@/lib/auth/current";
import { globalSearch } from "@/lib/services/shell";

// The header search box asks here as you type.
export async function GET(req: Request) {
  const u = await getCurrentUser();
  if (!u) return Response.json({ results: [] }, { status: 401 });
  if (u.planBlocked) return Response.json({ results: [] }, { status: 402 });
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return Response.json({ results: await globalSearch(u, q.slice(0, 100)) }, { headers: { "Cache-Control": "private, no-store" } });
}
