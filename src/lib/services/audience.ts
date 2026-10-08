import "server-only";
import type { CurrentUser } from "@/lib/auth/current";
import { daysBetween } from "@/lib/domain/dates";
import { listMembers } from "./members";
import { todayIso } from "./time";

export const AUDIENCES = {
  active: "All active members",
  expiring7: "Expiring in the next 7 days",
  expired30: "Expired in the last 30 days",
  dues: "Members with dues",
  all: "Everyone (not suspended)",
} as const;
export type Audience = keyof typeof AUDIENCES;

/** Member ids for a bulk message. */
export async function audienceIds(u: CurrentUser, a: Audience) {
  const { rows } = await listMembers(u, { all: true });
  const today = todayIso();
  const pick = rows.filter((r) => {
    if (r.status === "SUSPENDED") return false;
    const left = r.latestEnd ? daysBetween(r.latestEnd, today) : null;
    switch (a) {
      case "active":
        return left != null && left >= 0;
      case "expiring7":
        return left != null && left >= 0 && left <= 7;
      case "expired30":
        return left != null && left < 0 && left >= -30;
      case "dues":
        return r.outstanding > 0;
      case "all":
        return true;
      default:
        return false;
    }
  });
  return pick.map((r) => r.id);
}

export async function audienceCounts(u: CurrentUser) {
  const out = {} as Record<Audience, number>;
  for (const a of Object.keys(AUDIENCES) as Audience[]) out[a] = (await audienceIds(u, a)).length;
  return out;
}
