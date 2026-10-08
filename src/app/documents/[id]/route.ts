import { getCurrentUser, PLAN_ENDED } from "@/lib/auth/current";
import { readDocument } from "@/lib/services/documents";

// Member documents are private: streamed only to signed-in staff who may manage documents, and audited.
export async function GET(req: Request, ctx: RouteContext<"/documents/[id]">) {
  const u = await getCurrentUser();
  if (!u) return new Response("Sign in again.", { status: 401 });
  if (u.planBlocked) return new Response(PLAN_ENDED, { status: 402 });
  if (!u.can("documents.manage")) return new Response("Your role can't open member documents.", { status: 403 });
  const { id } = await ctx.params;
  const r = await readDocument(u, id);
  if (!r) return new Response("Not found", { status: 404 });
  const download = new URL(req.url).searchParams.has("download");
  return new Response(Buffer.from(r.body), {
    headers: {
      "Content-Type": r.doc.mime,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${r.doc.fileName.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    },
  });
}
