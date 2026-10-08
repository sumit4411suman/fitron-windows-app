"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import * as z from "zod";
import "@/lib/zod-config";
import { requireFeature, requirePermission } from "@/lib/auth/current";
import { cookies } from "next/headers";
import { BRANCH_COOKIE, requireUser } from "@/lib/auth/current";
import { reasonInput } from "@/lib/validation/billing";
import { deleteBranch, putSetting, saveBranch, setBranchActive, saveGymProfile, saveTax as saveTaxSettings } from "@/lib/services/settings";
import { getWaSettings, sendTest, setLinked } from "@/lib/services/whatsapp";
import { connectorAddress, connectorLogout, connectorProblem, connectorStatus, providerReady } from "@/lib/integrations/whatsapp";
import { connectCloud, disconnectCloud, resubmitTemplates } from "@/lib/services/wa-connect";
import { removeGymLogo, setGymLogo } from "@/lib/services/gym-logo";
import { aiInput, autopayInput, branchInput, cookieNoticeInput, gymInput, numberingInput, privacyNoticeInput, privacyOfficerInput, reminderInput, reportsInput, taxInput } from "@/lib/validation/settings";
import { assertCanErase, eraseCheck, eraseMember, findMemberByCode, savePrivacyNotice as storeNotice } from "@/lib/services/privacy";
import { NOTICE_KEYS, type NoticeKey } from "@/lib/domain/privacy";
import { todayIso } from "@/lib/services/time";
import { fmtDate, formatRupees } from "@/lib/format";
import { checkAutopayConnection } from "@/lib/services/autopay";
import { accessInput } from "@/lib/validation/frontdesk";
import { UserError } from "@/lib/services/errors";
import { ensureTrainerCode } from "@/lib/services/trainer-gym";
import { saveReminderSettings } from "@/lib/services/reminders";
import { formAction, simpleAction } from "@/lib/form-action";
import { failed, type FormState } from "@/lib/validation/common";
import { headers } from "next/headers";
import { rateLimit } from "@/lib/rate-limit";
import { ticketInput } from "@/lib/validation/support";
import { raiseTicket, resolveTicket } from "@/lib/services/support";

const back = (params: Record<string, string>) => redirect(`/settings?${new URLSearchParams(params)}`);
const firstError = (e: z.ZodError) => e.issues.map((i) => `${String(i.path[0] ?? "")}: ${i.message}`)[0] ?? "Check the form.";

async function save<T extends z.ZodType>(schema: T, fd: FormData, section: string, fn: (v: z.infer<T>) => Promise<void>, extra: Record<string, string> = {}) {
  const parsed = schema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) back({ error: extra.branch ? (parsed.error.issues[0]?.message ?? "Check the form.") : firstError(parsed.error), section, ...extra });
  try {
    await fn(parsed.data as z.infer<T>);
  } catch (e) {
    if (e instanceof UserError) back({ error: e.message, section, ...extra });
    throw e;
  }
  revalidatePath("/", "layout");
  back({ saved: section });
}

export async function saveGym(fd: FormData) {
  const u = await requirePermission("settings.manage");
  await save(gymInput, fd, "gym", async (v) => {
    await saveGymProfile(u, v);
  });
}

/** Settings › Privacy & DPDP › Grievance Officer and retention (Setting `privacy`, audited). */
export async function savePrivacyOfficer(fd: FormData) {
  const u = await requirePermission("settings.manage");
  await save(privacyOfficerInput, fd, "privacy", async (v) => {
    await putSetting(u, "privacy", { officer: v.officer ?? "", email: v.email ?? "", phone: v.phone ?? "", retainMonths: v.retainMonths });
  });
}

/** The gym's privacy notice: stores only the sections edited away from the template; Reset to template clears them. */
export async function savePrivacyNotice(fd: FormData) {
  const u = await requirePermission("settings.manage");
  await save(privacyNoticeInput, fd, "privacy", async (v) => {
    if (v.reset) await storeNotice(u, null);
    else await storeNotice(u, Object.fromEntries(NOTICE_KEYS.map((k) => [k, v[`n_${k}`]])) as Record<NoticeKey, string>);
  });
}

export async function saveCookieNotice(fd: FormData) {
  const u = await requirePermission("settings.manage");
  await save(cookieNoticeInput, fd, "privacy", async (v) => {
    await putSetting(u, "privacy", { cookieNotice: v.cookieNotice, noticeUpdatedAt: todayIso() });
  });
}

type EraseLookup = { error: string } | { name: string; code: string; outstanding: number; activeTill: string | null; erased: string | null };

/** What stands in the way of erasing the member typed in Settings › Privacy & DPDP (never throws to the client). */
export async function lookupForErase(code: string): Promise<EraseLookup> {
  const u = await requirePermission("settings.manage");
  try {
    assertCanErase(u);
    const m = await findMemberByCode(u, String(code ?? ""));
    if (!m) return { error: "No member with that ID." };
    if (m.erasedAt) return { error: `This member's personal data was already erased on ${fmtDate(m.erasedAt)}.` };
    const c = await eraseCheck(m.id);
    if (c.outstanding > 0) return { error: `Settle the ${formatRupees(c.outstanding)} balance before erasing.` };
    if (c.activeTill || c.mandateOpen) return { error: `${m.name} is still a member till ${fmtDate(c.activeTill ?? todayIso())}. End the membership (and any autopay mandate) before erasing.` };
    return { name: m.name, code: m.code, outstanding: c.outstanding, activeTill: c.activeTill, erased: null };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}

/** Erases the member's personal data with a reason; invoices and payments keep only the member ID. */
export async function eraseMemberAction(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("settings.manage");
  try {
    assertCanErase(u);
    const reason = String(fd.get("reason") ?? "").trim();
    if (reason.length < 3) return { message: "Give a reason.", errors: { reason: ["Give a reason."] } };
    const m = await findMemberByCode(u, String(fd.get("member") ?? ""));
    if (!m) return { message: "No member with that ID." };
    await eraseMember(u, m.id, reason);
  } catch (e) {
    if (e instanceof UserError) return { message: e.message };
    throw e;
  }
  revalidatePath("/", "layout");
  redirect(`/settings?${new URLSearchParams({ tab: "privacy", saved: "privacy", msg: "Personal data erased" })}`);
}

/** Uploads a new gym logo (a PNG from the crop dialog), or goes back to the default with intent=remove. */
export async function changeLogo(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("settings.manage");
  const state =
    fd.get("intent") === "remove"
      ? await simpleAction(() => removeGymLogo(u), "Logo reset to default.")
      : await simpleAction(() => setGymLogo(u, fd.get("logo") as File), "Logo updated.");
  if (state?.ok) revalidatePath("/", "layout");
  return state;
}

/** The gym's AI Trainer code for the Gym Partnership, made once. */
export async function makeTrainerCode() {
  const u = await requirePermission("settings.manage");
  await ensureTrainerCode(u.orgId);
  revalidatePath("/settings");
  back({ saved: "gym" });
}

export async function saveTax(fd: FormData) {
  const u = await requirePermission("settings.manage");
  await save(taxInput, fd, "tax", async (v) => {
    await saveTaxSettings(u, v);
  });
}

export async function saveNumbering(fd: FormData) {
  const u = await requirePermission("settings.manage");
  await save(numberingInput, fd, "numbering", async (v) => {
    await putSetting(u, "numbering", v);
  });
}

export async function saveBranchAction(id: string | null, fd: FormData) {
  const u = await requirePermission("settings.manage");
  await save(branchInput, fd, "branches", async (v) => {
    await saveBranch(u, id, v);
  }, { tab: "branches", branch: id ?? "new" });
}

const toBranches = (params: Record<string, string> = {}) => redirect(`/settings?${new URLSearchParams({ tab: "branches", ...params })}`);

/** Header switcher cookie: reset to the first open branch (or All) when the picked one is closed or deleted. */
async function resetBranchCookie(u: Awaited<ReturnType<typeof requirePermission>>, gone: string) {
  if (u.branch !== gone) return;
  const open = u.branches.filter((b) => b.active && b.id !== gone);
  (await cookies()).set(BRANCH_COOKIE, open.length > 1 ? "ALL" : (open[0]?.id ?? "ALL"), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
}

export async function openBranch(id: string) {
  const u = await requireUser();
  if (!u.branches.some((b) => b.id === id && b.active)) toBranches({ error: "That branch isn’t open." });
  (await cookies()).set(BRANCH_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function setBranchActiveAction(id: string, active: boolean) {
  const u = await requirePermission("settings.manage");
  try {
    await setBranchActive(u, id, active);
  } catch (e) {
    if (e instanceof UserError) toBranches({ error: e.message });
    throw e;
  }
  if (!active) await resetBranchCookie(u, id);
  revalidatePath("/", "layout");
  toBranches({ saved: "branches" });
}

export async function deleteBranchAction(id: string, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("settings.manage");
  const r = await formAction(fd, reasonInput, (d) => deleteBranch(u, id, d.reason), "Branch deleted.");
  if (r?.ok) {
    await resetBranchCookie(u, id);
    revalidatePath("/", "layout");
  }
  return r;
}

export async function saveAccess(fd: FormData) {
  const u = await requirePermission("settings.manage");
  await save(accessInput, fd, "access", async (v) => {
    await putSetting(u, "access", v);
  });
}

const waInput = z.object({ mode: z.enum(["demo", "cloud", "connector"]) });

/** Settings › WhatsApp: only how messages go out. The reminder schedule is saved from the Reminders tab. */
export async function saveWhatsApp(fd: FormData) {
  const u = await requirePermission("settings.manage");
  await save(waInput, fd, "whatsapp", async (v) => {
    await putSetting(u, "whatsapp", v);
  });
}

/** Settings › Reminders: every field drives the daily jobs, the sell form and door access for real. */
export async function saveReminders(fd: FormData) {
  const u = await requirePermission("settings.manage");
  const raw = { ...Object.fromEntries(fd), expiryDays: fd.getAll("expiryDays") };
  const parsed = reminderInput.safeParse(raw);
  if (!parsed.success) back({ error: firstError(parsed.error), section: "reminders" });
  await saveReminderSettings(u, parsed.data!);
  revalidatePath("/", "layout");
  back({ saved: "reminders" });
}

/** Settings › Reminders › Reports by email: whether the Super Admins get last month's profit and loss on the 1st. */
export async function saveReports(fd: FormData) {
  const u = await requirePermission("settings.manage");
  if (!u.has("accounting")) back({ error: "The monthly profit and loss is part of Accounting, on the Professional plan.", section: "reminders" });
  await save(reportsInput, fd, "reminders", async (v) => {
    await putSetting(u, "reports", v);
  });
}

/** Settings › Integrations & AI › UPI autopay: mode, retries and the gap between them (the provider is Razorpay only). */
export async function saveAutopay(fd: FormData) {
  const u = await requirePermission("settings.manage");
  await save(autopayInput, fd, "autopay", async (v) => {
    await putSetting(u, "autopay", v);
  });
}

/** "Test connection": one audited check against Razorpay with the server keys; demo mode has nothing to test. */
export async function testAutopayConnection() {
  const u = await requirePermission("settings.manage");
  if (!u.has("autopay")) back({ error: "UPI autopay is on the Professional plan.", section: "autopay" });
  await checkAutopayConnection(u);
  revalidatePath("/settings");
  back({ saved: "autopay" });
}

/** Settings › Integrations & AI › Fitron AI: the three switches drive the sidebar, the dashboard brief and win-back drafts. */
export async function saveAi(fd: FormData) {
  const u = await requirePermission("settings.manage");
  if (!u.has("ai")) back({ error: "Fitron AI is on the Professional plan.", section: "ai" });
  await save(aiInput, fd, "ai", async (v) => {
    await putSetting(u, "ai", v);
  });
}

/** Linking, testing and unlinking WhatsApp: a Super Admin on a plan with WhatsApp. */
async function waUser() {
  await requirePermission("settings.manage");
  return requireFeature("whatsapp");
}
const waBack = (params: Record<string, string>) => back({ tab: "wa", ...params });

/** "Send test" on the Linked WhatsApp card: one message to the gym's own number. */
export async function sendTestAction() {
  const u = await waUser();
  let msg: Awaited<ReturnType<typeof sendTest>>;
  try {
    msg = await sendTest(u);
  } catch (e) {
    if (e instanceof UserError) waBack({ error: e.message });
    throw e;
  }
  revalidatePath("/whatsapp");
  if (msg.status === "Failed") waBack({ error: `Test failed: ${msg.error}` });
  waBack({ msg: msg.status === "Queued" ? "Test message queued on your linked WhatsApp." : msg.status === "Logged" ? "WhatsApp is not linked yet: test message saved, not sent." : "Test message sent." });
}

/** "Unlink": the connector signs out (or the Meta connection is forgotten) and messages are saved but not sent until the gym links again. */
export async function unlinkAction() {
  const u = await waUser();
  const mode = (await getWaSettings(u.orgId)).mode;
  if (mode === "cloud") await disconnectCloud(u);
  else {
    if (mode === "connector" && !providerReady("connector")) await connectorLogout(u.orgId);
    await setLinked(u, null, "demo");
  }
  revalidatePath("/", "layout");
  waBack({ msg: "WhatsApp unlinked." });
}

export type ConnectResult = { ok: true; number: string; name: string; submitted: number; failed: number; warnings: string[] } | { ok: false; error: string };

/**
 * After Meta's Connect pop-up: the browser sends the code and the ids Meta returned. Stores the gym's own WhatsApp Business
 * connection, switches sending to it and submits the message templates for approval.
 */
export async function connectCloudAction(input: { code: string; wabaId: string; phoneNumberId: string }): Promise<ConnectResult> {
  const u = await waUser();
  if (!rateLimit(`wa-connect:${u.orgId}`, 10, 60 * 60_000)) return { ok: false, error: "Too many tries in an hour. Wait a little and try again." };
  try {
    const r = await connectCloud(u, { code: String(input?.code ?? ""), wabaId: String(input?.wabaId ?? ""), phoneNumberId: String(input?.phoneNumberId ?? "") });
    revalidatePath("/", "layout");
    return { ok: true, ...r };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    throw e;
  }
}

/** "Resubmit templates": sends the gym's message templates to Meta again (the ones it refused, or that never went). */
export async function resubmitTemplatesAction() {
  const u = await waUser();
  try {
    const r = await resubmitTemplates(u);
    waBack({ msg: r.failed ? `${r.submitted} templates are with Meta; ${r.failed} could not be submitted (see the list).` : `${r.submitted} templates are with Meta for approval.` });
  } catch (e) {
    if (e instanceof UserError) waBack({ error: e.message });
    throw e;
  }
}

export type LinkStatus = { state: "offline" | "waiting" | "qr" | "ready"; qr?: string; number?: string; text: string; problem?: string };

/**
 * Polled by the Link WhatsApp dialog: the connector's state and QR code. Once the phone is linked,
 * the gym is marked linked (mode connector) and the dialog closes.
 */
export async function linkStatusAction(): Promise<LinkStatus> {
  const u = await waUser();
  const missing = providerReady("connector");
  if (missing) return { state: "offline", text: missing };
  let st: Awaited<ReturnType<typeof connectorStatus>>;
  try {
    st = await connectorStatus(u.orgId);
  } catch (e) {
    return { state: "offline", text: connectorProblem(e) };
  }
  if (st.state === "ready") {
    const number = (st.number ?? "").replace(/\D/g, "");
    const s = await getWaSettings(u.orgId);
    if (!(s.mode === "connector" && s.linked?.number === number)) {
      let host = "gym PC";
      try {
        host = new URL(connectorAddress()).host || host;
      } catch {
        // Keep the fallback.
      }
      await setLinked(u, { number, device: `Fitron connector · ${host}`, at: new Date().toISOString() }, "connector");
      revalidatePath("/", "layout");
    }
    return { state: "ready", number, text: "Linked." };
  }
  if (st.qr) return { state: "qr", qr: st.qr, text: "" };
  return { state: "waiting", text: st.state === "authenticating" ? "Scanned. Finishing link…" : "Connector is starting WhatsApp…", problem: st.error ?? undefined };
}

/** Settings › Help & support › Raise a ticket: saved, audited and emailed to support. */
export async function raiseTicketAction(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("settings.manage");
  if (!rateLimit(`ticket:${u.orgId}`, 10, 60 * 60_000)) return failed(fd, { message: "That's a lot of tickets in an hour. Wait a little and try again." });
  const h = await headers();
  const ctx = { userAgent: h.get("user-agent"), ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null };
  let number = "";
  const res = await formAction(fd, ticketInput, async (v) => {
    number = (await raiseTicket(u, v, ctx)).number;
  }, "");
  if (res?.ok) {
    revalidatePath("/settings");
    return { ...res, message: `Ticket ${number} raised. We'll reply here and by email.` };
  }
  return res;
}

export async function resolveTicketAction(id: string) {
  const u = await requirePermission("settings.manage");
  try {
    await resolveTicket(u, id);
  } catch (e) {
    if (e instanceof UserError) redirect(`/settings?${new URLSearchParams({ tab: "help", error: e.message })}`);
    throw e;
  }
  revalidatePath("/settings");
  redirect("/settings?tab=help");
}
