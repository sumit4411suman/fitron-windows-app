import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { CurrentUser } from "@/lib/auth/current";
import { defaultForm, firstInvalid, planKind, planRows, staffRows, type OnboardingForm, type OnboardingState, type StepKey } from "@/lib/domain/onboarding";
import { planInput } from "@/lib/validation/plan";
import { staffInput } from "@/lib/validation/staff";
import { rupees } from "@/lib/validation/common";
import { audit } from "./audit";
import { UserError } from "./errors";
import { setOpening } from "./importer";
import { createPlan } from "./plans";
import { getSetting, putSetting, putSettingIn, saveBranch, saveTax } from "./settings";
import { createStaff } from "./staff";
import { DEFAULT_TAX } from "./tax";
import { todayIso } from "./time";
import { setAutoSend } from "./whatsapp";

/**
 * First-run setup. A gym that signed up on fitron.in starts with Setting `onboarding` = PENDING (src/lib/services/accounts.ts);
 * gyms set up by hand have none and never see the wizard. Answers are kept as a draft while the owner goes through the
 * steps and only applied, through the same audited functions Settings uses, when they press Finish setup.
 */

export const getOnboarding = (orgId: string) => getSetting<OnboardingState>(orgId, "onboarding");

/** The wizard's starting point: what the owner already typed if they came back, else the suggestions. */
export async function wizardStart(orgId: string): Promise<{ form: OnboardingForm; step: StepKey | null }> {
  const state = await getOnboarding(orgId);
  const base = defaultForm();
  const draft = state?.draft;
  const form = draft ? ({ ...base, ...draft, staff: draft.staff?.length ? draft.staff : base.staff } as OnboardingForm) : base;
  return { form, step: state?.step ?? null };
}

/** Remembers the answers so far, without the staff passwords (nothing secret is kept in a setting). */
export async function saveDraft(u: CurrentUser, step: StepKey, form: OnboardingForm) {
  const state = await getOnboarding(u.orgId);
  if (!state) throw new UserError("Setup isn't available for this gym.");
  if (state.status === "DONE") throw new UserError("Setup is already finished.");
  const draft = { ...form, staff: form.staff.map((s) => ({ ...s, password: "" })) };
  const value = { ...state, step, draft } as unknown as Prisma.InputJsonValue;
  await db.setting.upsert({ where: { orgId_key: { orgId: u.orgId, key: "onboarding" } }, create: { orgId: u.orgId, key: "onboarding", value }, update: { value } });
}

/** "Skip for now": the console opens, and the dashboard keeps a reminder to finish. */
export async function skipOnboarding(u: CurrentUser) {
  const state = await getOnboarding(u.orgId);
  if (!state || state.status === "DONE") return;
  if (state.status === "SKIPPED") return;
  await putSetting(u, "onboarding", { status: "SKIPPED", at: new Date().toISOString() });
}

const money = (s: string) => s.replace(/[₹,\s]/g, "");

/**
 * Applies every answer: tax and numbering, the branch, opening balances, WhatsApp automations, plans and team. Everything is
 * checked first, so a typo stops it before anything changes; each step is idempotent, so pressing Finish again after a failure
 * carries on instead of doubling anything.
 */
export async function finishOnboarding(u: CurrentUser, form: OnboardingForm, steps: StepKey[]) {
  const state = await getOnboarding(u.orgId);
  if (!state) throw new UserError("Setup isn't available for this gym.");
  if (state.status === "DONE") throw new UserError("Setup is already finished.");
  const bad = firstInvalid(steps, form);
  if (bad) throw new UserError(bad.message, bad.step);

  const staff = steps.includes("staff") ? staffRows(form) : [];
  const emails = staff.map((s) => s.email.trim().toLowerCase());
  const known = emails.length ? await db.user.findMany({ where: { email: { in: emails } }, select: { email: true, orgId: true } }) : [];
  const elsewhere = known.find((k) => k.orgId !== u.orgId);
  if (elsewhere) throw new UserError(`${elsewhere.email} already has a FITRON account. Use another email for this team member.`, "staff");
  const roles = new Map((await db.role.findMany({ select: { id: true, name: true } })).map((r) => [r.name, r.id]));
  const branch = await db.branch.findFirst({ where: { orgId: u.orgId, active: true }, orderBy: { createdAt: "asc" } });
  if (!branch) throw new UserError("Your gym has no open branch.", "branch");

  // Billing & GST, and where invoice numbers start.
  const t = form.tax;
  const gstin = t.gst ? t.gstin.trim().toUpperCase() : undefined;
  const rate = Number(t.rate);
  await saveTax(u, { enabled: t.gst, rate: Number.isFinite(rate) ? Math.min(28, Math.max(0, rate)) : DEFAULT_TAX.rate, type: t.type, gstin, sac: DEFAULT_TAX.sac, invoicePrefix: t.prefix.trim().toUpperCase() });
  await setInvoiceStart(u, Number(t.start.trim()));

  // The main branch keeps the address and phone the gym signed up with; the GSTIN is the gym's.
  const city = (await getSetting<{ city?: string }>(u.orgId, "gym"))?.city?.trim();
  const short = form.branch.short.trim();
  await saveBranch(u, branch.id, {
    name: [short, city].filter(Boolean).join(", ").slice(0, 80),
    short,
    address: branch.address,
    phone: branch.phone,
    manager: form.branch.manager.trim() || undefined,
    hours: form.branch.hours.trim(),
    invoicePrefix: branch.invoicePrefix ?? undefined,
    gstin: gstin ?? branch.gstin ?? undefined,
  });

  if (steps.includes("opening")) {
    const cash = rupees.parse(money(form.opening.cash) || "0");
    const bank = rupees.parse(money(form.opening.bank) || "0");
    if (cash > 0 || bank > 0) await setOpening(u, { cash, bank, asOf: todayIso() });
  }

  if (steps.includes("whatsapp")) {
    const w = form.wa;
    for (const [key, on] of [["welcome", w.welcome], ["exp7", w.d7], ["exp3", w.d3], ["exp1", w.d1], ["expired", w.d0], ["birthday", w.birthday]] as const) await setAutoSend(u, key, on);
  }

  // Plans already there (same name) are left alone, so a second Finish never doubles them.
  const have = new Set((await db.membershipPlan.findMany({ where: { orgId: u.orgId }, select: { name: true } })).map((p) => p.name.trim().toLowerCase()));
  let plansAdded = 0;
  for (const r of planRows(form)) {
    const name = r.name.trim();
    if (have.has(name.toLowerCase())) continue;
    const parsed = planInput.safeParse({ name, kind: planKind(name), months: r.months.trim(), price: r.price, regFee: r.regFee.trim() || "0", discount: "0", gstApplicable: t.gst ? "on" : "", description: "", features: "" });
    if (!parsed.success) throw new UserError(`${name}: ${parsed.error.issues[0]?.message ?? "check this plan."}`, "plans");
    await createPlan(u, parsed.data);
    plansAdded++;
  }

  // The team starts with the owner's own first passwords; anyone already added (same email, this gym) is skipped.
  const mine = new Set(known.filter((k) => k.orgId === u.orgId).map((k) => k.email.toLowerCase()));
  let staffAdded = 0;
  for (const s of staff) {
    if (mine.has(s.email.trim().toLowerCase())) continue;
    const roleId = roles.get(s.role);
    if (!roleId) throw new UserError(`${s.name.trim()}: pick a role.`, "staff");
    const parsed = staffInput.safeParse({ name: s.name.trim(), email: s.email.trim(), phone: s.phone, roleId, branchIds: [branch.id], shift: "", ptRate: 0, password: s.password });
    if (!parsed.success) throw new UserError(`${s.name.trim()}: ${parsed.error.issues[0]?.message ?? "check these details."}`, "staff");
    await createStaff(u, parsed.data);
    staffAdded++;
  }

  await db.$transaction(async (tx) => {
    await putSettingIn(tx, u, "onboarding", { status: "DONE", at: new Date().toISOString(), draft: null, step: null });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "onboarding.complete", entity: "Organization", entityId: u.orgId, after: { gst: t.gst, plansAdded, staffAdded, mode: form.mode } });
  });
  return { mode: form.mode, plansAdded, staffAdded };
}

/** The first invoice number. Only before any invoice exists: numbers stay gap-free once one has been issued. */
async function setInvoiceStart(u: CurrentUser, next: number) {
  await db.$transaction(async (tx) => {
    if ((await tx.invoice.count({ where: { orgId: u.orgId } })) > 0) return;
    const key = { orgId_name: { orgId: u.orgId, name: "invoice" } };
    const before = await tx.sequence.findUnique({ where: key });
    if (before?.next === next) return;
    await tx.sequence.upsert({ where: key, create: { orgId: u.orgId, name: "invoice", next }, update: { next } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "sequence.start", entity: "Sequence", entityId: "invoice", before, after: { next } });
  });
}
