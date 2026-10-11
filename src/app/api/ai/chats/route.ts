import { listChats } from "@/lib/services/ai-chats";
import { aiUser } from "../_lib/access";

// The signed-in person's saved Fitron AI chats, newest first: GET → { chats: [{ id, title, updatedAt }] }.
export async function GET() {
  const u = await aiUser();
  if (u instanceof Response) return u;
  return Response.json({ chats: await listChats(u) }, { headers: { "cache-control": "no-store" } });
}
