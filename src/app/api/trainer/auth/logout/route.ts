import { endTrainerSession } from "@/lib/services/trainer-session";
import { json } from "../../_lib/http";

export async function POST() {
  await endTrainerSession();
  return json({ ok: true });
}
