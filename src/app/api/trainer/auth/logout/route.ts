import { endTrainerSession } from "@/lib/services/trainer-session";
import { json } from "../../_lib/http";
import { notInLocal } from "@/lib/runtime/not-in-local";

export async function POST() {
  const off = notInLocal();
  if (off) return off;
  await endTrainerSession();
  return json({ ok: true });
}
