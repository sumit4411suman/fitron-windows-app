import { loadTrainer } from "@/lib/services/trainer";
import { json, withTrainer } from "../_lib/http";
import { notInLocal } from "@/lib/runtime/not-in-local";

/** Everything the app loads on open for the signed-in member. 401 when signed out. */
export async function GET() {
  const off = notInLocal();
  if (off) return off;
  return withTrainer(async (m) => json(await loadTrainer(m.id)));
}
