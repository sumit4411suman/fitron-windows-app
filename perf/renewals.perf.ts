import { it } from "vitest";

// Diagnostic: the pieces of the Renewals page on the performance dataset.
it.skipIf(!process.env.PERF_PROFILE)("profiles renewals", async () => {
  const { db } = await import("@/lib/db");
  const { systemUser } = await import("@/lib/auth/system");
  const u = await systemUser((await db.organization.findFirstOrThrow()).id);
  const { listMembers } = await import("@/lib/services/members");
  const { lastRenewalReminders, renewalAmounts, reminderSchedule } = await import("@/lib/services/reminders");
  const { getWaSettings } = await import("@/lib/services/whatsapp");
  const out: Record<string, number> = {};
  const t = async <T>(k: string, fn: () => Promise<T>) => {
    const s = performance.now();
    const r = await fn();
    out[k] = Math.round(performance.now() - s);
    return r;
  };
  const { rows } = await t("listMembers all", () => listMembers(u, { all: true }));
  await t("listMembers all (again, warm)", () => listMembers(u, { all: true }));
  await t("wa settings", () => getWaSettings(u.orgId));
  await t("schedule", () => reminderSchedule(u.orgId));
  const ids = rows.slice(0, 300).map((m) => m.id);
  await t("lastRenewalReminders 300", () => lastRenewalReminders(ids));
  await t("renewalAmounts 300", () => renewalAmounts(ids));
  const all = rows.map((m) => m.id);
  await t("lastRenewalReminders all", () => lastRenewalReminders(all));
  await t("renewalAmounts all", () => renewalAmounts(all));
  (await import("node:fs")).writeFileSync(`${process.env.FITRON_DATA_DIR}/renewals.json`, JSON.stringify(out, null, 1));
});
