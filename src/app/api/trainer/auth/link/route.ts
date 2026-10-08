import { rateLimit } from "@/lib/rate-limit";
import { UserError } from "@/lib/services/errors";
import { requestTrainerLink } from "@/lib/services/trainer";
import { body, json } from "../../_lib/http";
import { log } from "@/lib/log";

/** Email a one-time sign-in link (creates the account on first use). */
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!rateLimit(`trainer-link:${ip}`, 10, 10 * 60_000)) return json({ error: "Too many tries. Wait a few minutes and try again." }, 429);
  try {
    const { email } = await body<{ email?: string }>(req, 4_000);
    return json(await requestTrainerLink(String(email ?? "")));
  } catch (e) {
    if (e instanceof UserError) return json({ error: e.message }, 400);
    log.error("trainer_link.failed", e);
    return json({ error: "Couldn't send the link. Try again." }, 500);
  }
}
