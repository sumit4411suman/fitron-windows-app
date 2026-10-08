import "server-only";
import { randomInt } from "node:crypto";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import { TEST_META_TEMPLATE, toMetaTemplate, type MetaTemplate } from "@/lib/domain/wa-meta";
import { exchangeCode, phoneInfo, registerNumber, submitTemplates, subscribeApp, templateStatuses, type CloudCreds, type TemplateStatus } from "@/lib/integrations/whatsapp-cloud";
import { audit } from "./audit";
import { UserError } from "./errors";
import { getCloudCreds, getCloudInfo, removeCloud, saveCloud, saveTemplateRows, type CloudInfo, type CloudTemplateRow } from "./wa-cloud-store";
import { listTemplates, setLinked } from "./whatsapp";

// A gym owner connects her own WhatsApp Business number with Meta's Connect pop-up. The pop-up gives the browser a short-lived
// code plus the ids of her WhatsApp Business account and number; this turns them into a stored connection and gets her
// message templates submitted to Meta for approval.

const ID = /^\d{5,30}$/;

/** This gym's templates in Meta's format (its own text, so edits count), plus the "Send test" one. */
async function metaTemplatesFor(orgId: string): Promise<MetaTemplate[]> {
  const own = (await listTemplates(orgId)).flatMap((t) => toMetaTemplate(t.key, t.body, t.language) ?? []);
  return [...own, TEST_META_TEMPLATE];
}

/** Submits the gym's templates and remembers which Meta name goes with which template, so sending can use them. */
async function submitFor(orgId: string, creds: CloudCreds): Promise<CloudTemplateRow[]> {
  const results = await submitTemplates(creds, await metaTemplatesFor(orgId));
  await db.$transaction(
    results.filter((r) => r.ok && r.key !== "test").map((r) => db.whatsAppTemplate.updateMany({ where: { orgId, key: r.key }, data: { metaTemplateName: r.name } })),
  );
  return results.map((r) => ({ key: r.key, name: r.name, ok: r.ok, ...(r.error ? { error: r.error } : {}) }));
}

export type ConnectInput = { code: string; wabaId: string; phoneNumberId: string };

/** Everything after the Connect pop-up. Throws a message the owner can read; nothing is stored unless Meta accepted the connection. */
export async function connectCloud(u: CurrentUser, input: ConnectInput) {
  if (!input.code || !ID.test(input.wabaId) || !ID.test(input.phoneNumberId)) throw new UserError("Meta did not finish the connection. Press Connect and complete every step.");
  let token: string;
  try {
    token = await exchangeCode(input.code);
  } catch (e) {
    throw new UserError(e instanceof Error ? e.message : "Meta did not accept the connection.");
  }
  const creds: CloudCreds = { token, wabaId: input.wabaId, phoneNumberId: input.phoneNumberId };
  let info;
  try {
    info = await phoneInfo(creds);
  } catch (e) {
    throw new UserError(`Connected to Meta, but the number could not be read: ${e instanceof Error ? e.message : e}`);
  }
  // Switching the number on and the delivery receipts are best-effort: the owner can still send, and the page says what is missing.
  const pin = String(randomInt(100_000, 1_000_000));
  const warnings: string[] = [];
  await registerNumber(creds, pin).catch((e) => warnings.push(`Number registration: ${e instanceof Error ? e.message : e}`));
  await subscribeApp(creds).catch((e) => warnings.push(`Delivery receipts: ${e instanceof Error ? e.message : e}`));
  const templates = await submitFor(u.orgId, creds);
  const saved: CloudInfo = { number: info.display_phone_number ?? "", name: info.verified_name ?? "", wabaId: creds.wabaId, phoneNumberId: creds.phoneNumberId, connectedAt: new Date().toISOString(), templates };
  await saveCloud(u.orgId, saved, { token, pin });
  await setLinked(u, null, "cloud");
  await db.$transaction((tx) => audit(tx, { orgId: u.orgId, userId: u.id, action: "whatsapp.connect", entity: "Setting", entityId: "whatsapp_cloud", after: { number: saved.number, name: saved.name, wabaId: saved.wabaId, phoneNumberId: saved.phoneNumberId, templates: templates.filter((t) => t.ok).length, warnings } }));
  return { number: saved.number, name: saved.name, submitted: templates.filter((t) => t.ok).length, failed: templates.filter((t) => !t.ok).length, warnings };
}

/** "Disconnect": forget the connection (the token is deleted). Messages are saved but not sent until the gym connects again. */
export async function disconnectCloud(u: CurrentUser) {
  const info = await getCloudInfo(u.orgId);
  await removeCloud(u.orgId);
  await db.whatsAppTemplate.updateMany({ where: { orgId: u.orgId, metaTemplateName: { startsWith: "fitron_" } }, data: { metaTemplateName: null } });
  await setLinked(u, null, "demo");
  await db.$transaction((tx) => audit(tx, { orgId: u.orgId, userId: u.id, action: "whatsapp.disconnect", entity: "Setting", entityId: "whatsapp_cloud", before: info ? { number: info.number, wabaId: info.wabaId } : null }));
}

/** "Resubmit templates": tries again the ones Meta refused or that never went. */
export async function resubmitTemplates(u: CurrentUser) {
  const creds = await getCloudCreds(u.orgId);
  if (!creds) throw new UserError("Connect WhatsApp first.");
  const rows = await submitFor(u.orgId, creds);
  await saveTemplateRows(u.orgId, rows);
  await db.$transaction((tx) => audit(tx, { orgId: u.orgId, userId: u.id, action: "whatsapp.templates", entity: "Setting", entityId: "whatsapp_cloud", after: { submitted: rows.filter((r) => r.ok).length, failed: rows.filter((r) => !r.ok).length } }));
  return { submitted: rows.filter((r) => r.ok).length, failed: rows.filter((r) => !r.ok).length };
}

/** Where the gym's templates stand with Meta, or null when it is not connected or Meta cannot be reached. */
export async function cloudTemplateStatus(orgId: string): Promise<{ list: TemplateStatus[]; approved: number; pending: number; rejected: number } | null> {
  const creds = await getCloudCreds(orgId);
  if (!creds?.wabaId) return null;
  try {
    const mine = (await templateStatuses(creds)).filter((t) => t.name.startsWith("fitron_"));
    return { list: mine, approved: mine.filter((t) => t.status === "APPROVED").length, pending: mine.filter((t) => t.status === "PENDING" || t.status === "IN_APPEAL").length, rejected: mine.filter((t) => t.status === "REJECTED").length };
  } catch {
    return null;
  }
}
