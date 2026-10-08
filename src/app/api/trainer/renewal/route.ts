import { memberWithRenewal, setTrainerRenewal } from "@/lib/services/trainer";
import { UserError } from "@/lib/services/errors";
import { body, json, withTrainer } from "../_lib/http";

/** Stop (or resume) renewal. For a plan that renews itself this stops the charges at Razorpay; a stopped one can't be resumed. */
export async function POST(req: Request) {
  return withTrainer(async (m) => {
    const { cancelled } = await body<{ cancelled?: unknown }>(req);
    // A stray "false" or 0 once read as "stop renewing"; only a real boolean is taken.
    if (typeof cancelled !== "boolean") throw new UserError("Couldn't read that choice. Close this and try again.");
    return json({ member: await memberWithRenewal(await setTrainerRenewal(m.id, cancelled)) });
  });
}
