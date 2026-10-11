import { deleteChat, getChat } from "@/lib/services/ai-chats";
import { UserError } from "@/lib/services/errors";
import { aiUser } from "../../_lib/access";

// One of the signed-in person's chats: GET → { id, title, turns }, DELETE → { ok: true }. Anyone else's answers 404.
const notFound = (e: unknown) => {
  if (e instanceof UserError) return Response.json({ error: e.message }, { status: 404 });
  throw e;
};

export async function GET(_req: Request, { params }: RouteContext<"/api/ai/chats/[id]">) {
  const u = await aiUser();
  if (u instanceof Response) return u;
  const { id } = await params;
  return getChat(u, id).then((c) => Response.json(c, { headers: { "cache-control": "no-store" } }), notFound);
}

export async function DELETE(_req: Request, { params }: RouteContext<"/api/ai/chats/[id]">) {
  const u = await aiUser();
  if (u instanceof Response) return u;
  const { id } = await params;
  return deleteChat(u, id).then(() => Response.json({ ok: true }), notFound);
}
