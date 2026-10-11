import { trainerReviews } from "@/lib/services/trainer";
import { json, withTrainer } from "../_lib/http";
import { notInLocal } from "@/lib/runtime/not-in-local";

/** Past weekly reviews, newest first. */
export async function GET() {
  const off = notInLocal();
  if (off) return off;
  return withTrainer(async (m) => json({ reviews: await trainerReviews(m.id) }));
}
