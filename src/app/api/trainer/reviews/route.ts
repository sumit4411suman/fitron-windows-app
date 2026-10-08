import { trainerReviews } from "@/lib/services/trainer";
import { json, withTrainer } from "../_lib/http";

/** Past weekly reviews, newest first. */
export async function GET() {
  return withTrainer(async (m) => json({ reviews: await trainerReviews(m.id) }));
}
