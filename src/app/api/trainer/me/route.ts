import { loadTrainer } from "@/lib/services/trainer";
import { json, withTrainer } from "../_lib/http";

/** Everything the app loads on open for the signed-in member. 401 when signed out. */
export async function GET() {
  return withTrainer(async (m) => json(await loadTrainer(m.id)));
}
