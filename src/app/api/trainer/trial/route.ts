import { isTrainerPlan } from "@/lib/domain/trainer";
import { memberWithRenewal, startTrainerTrial } from "@/lib/services/trainer";
import { UserError } from "@/lib/services/errors";
import { body, json, withTrainer } from "../_lib/http";

/** Start the 7-day free trial (once per account). */
export async function POST(req: Request) {
  return withTrainer(async (m) => {
    const { plan } = await body<{ plan?: unknown }>(req);
    // The trial is started on a named plan, so the account can't silently keep an older one.
    if (!isTrainerPlan(plan)) throw new UserError("Pick AI Pro or AI Premium.");
    return json({ member: await memberWithRenewal(await startTrainerTrial(m.id, plan)) });
  });
}
