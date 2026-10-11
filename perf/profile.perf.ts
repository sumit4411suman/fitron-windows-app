import { it } from "vitest";

// Times the services behind each daily screen on the performance dataset (PERF_ROOT), in-process. A diagnostic for
// finding slow queries; npm run perf:local measures the screens themselves.
it.skipIf(!process.env.PERF_PROFILE)("profiles the services", async () => {
  const { db } = await import("@/lib/db");
  const { systemUser } = await import("@/lib/auth/system");
  const org = await db.organization.findFirstOrThrow();
  const u = await systemUser(org.id);
  const { listMembers } = await import("@/lib/services/members");
  const { listInvoices, listPayments, listReceivables } = await import("@/lib/services/billing");
  const { dashboardData } = await import("@/lib/services/dashboard");
  const { listExpenses } = (await import("@/lib/services/expenses")) as unknown as { listExpenses: (u: unknown, f: unknown) => Promise<unknown> };
  const { REPORTS } = await import("@/lib/services/reports");
  const { monthPeriod } = (await import("@/lib/domain/periods").catch(() => ({ monthPeriod: undefined }))) as { monthPeriod?: (m: string) => unknown };
  const out: [string, number][] = [];
  const t = async (what: string, fn: () => Promise<unknown>) => {
    const s = performance.now();
    await fn();
    out.push([what, Math.round(performance.now() - s)]);
  };
  await t("listMembers page 1", () => listMembers(u, { pageSize: 50 }));
  await t("listMembers q=Sharma", () => listMembers(u, { q: "Sharma", pageSize: 50 }));
  await t("listMembers all (renewals)", () => listMembers(u, { all: true }));
  await t("listInvoices", () => listInvoices(u, {}));
  await t("listPayments", () => listPayments(u, {}));
  await t("listReceivables", () => listReceivables(u));
  await t("dashboard month", () => dashboardData(u, "month" as never));
  if (listExpenses) await t("listExpenses", () => listExpenses(u, {}));
  for (const k of ["collections", "dues", "gst", "rev-month", "m-plan", "pl", "recv", "cashflow"]) {
    const def = REPORTS[k];
    if (!def) continue;
    await t(`report ${k}`, () => (def.run as (u: unknown, p: unknown) => Promise<unknown>)(u, monthPeriod ? monthPeriod("2026-09") : { from: "2026-09-01", to: "2026-09-30", label: "Sep" }));
  }
  (await import("node:fs")).writeFileSync(`${process.env.FITRON_DATA_DIR}/profile.json`, JSON.stringify(Object.fromEntries(out), null, 1));
});
