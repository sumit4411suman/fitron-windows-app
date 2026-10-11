import { deleteTrainerChat, saveTrainerChat } from "@/lib/services/trainer";
import { body, json, withTrainer } from "../../_lib/http";
import { notInLocal } from "@/lib/runtime/not-in-local";

export async function PUT(req: Request, ctx: RouteContext<"/api/trainer/chats/[id]">) {
  const off = notInLocal();
  if (off) return off;
  const { id } = await ctx.params;
  return withTrainer(async (m) => {
    const b = await body<{ title?: string; messages?: unknown }>(req);
    await saveTrainerChat(m.id, id, String(b.title ?? ""), b.messages);
    return json({ ok: true });
  });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/trainer/chats/[id]">) {
  const off = notInLocal();
  if (off) return off;
  const { id } = await ctx.params;
  return withTrainer(async (m) => {
    await deleteTrainerChat(m.id, id);
    return json({ ok: true });
  });
}
