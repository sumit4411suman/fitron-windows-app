import { linkTrainerGym, unlinkTrainerGym } from "@/lib/services/trainer-gym";
import { rateLimit } from "@/lib/rate-limit";
import { body, json, withTrainer } from "../_lib/http";

/** Link to a gym on FITRON with its trainer code (Gym Partnership). */
export async function POST(req: Request) {
  return withTrainer(async (m) => {
    // A trainer code is six characters, so guessing it is throttled per account and per address.
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    if (!rateLimit(`trainer-gym:${m.id}`, 10, 10 * 60_000) || !rateLimit(`trainer-gym-ip:${ip}`, 30, 10 * 60_000)) {
      return json({ error: "Too many tries. Wait a few minutes, then check the code with your gym." }, 429);
    }
    const b = await body<{ code?: unknown }>(req);
    return json({ gym: await linkTrainerGym(m.id, String(b.code ?? "")) });
  });
}

/** Leave the gym. */
export async function DELETE() {
  return withTrainer(async (m) => {
    await unlinkTrainerGym(m.id);
    return json({ gym: null });
  });
}
