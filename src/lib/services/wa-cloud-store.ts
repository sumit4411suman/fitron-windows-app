import "server-only";
import { db } from "@/lib/db";
import type { CloudCreds } from "@/lib/integrations/whatsapp-cloud";
import { seal, unseal } from "./biometric";

// Where a gym's WhatsApp Business connection is kept: Setting "whatsapp_cloud". The business token and the number's PIN are
// sealed (AES-256-GCM, the BIOMETRIC_KEY); the rest is plain. It is deliberately not in EDITABLE_SETTINGS (so no form or import
// can write it), and backups leave it out: a gym that is restored elsewhere connects again.
export const CLOUD_KEY = "whatsapp_cloud";

export type CloudTemplateRow = { key: string; name: string; ok: boolean; error?: string };
/** What the app may show: never the token. */
export type CloudInfo = { number: string; name: string; wabaId: string; phoneNumberId: string; connectedAt: string; templates: CloudTemplateRow[] };
type Stored = CloudInfo & { token: string; pin: string };

const read = async (orgId: string) => ((await db.setting.findUnique({ where: { orgId_key: { orgId, key: CLOUD_KEY } } }))?.value as Stored | null) ?? null;
const b64 = (s: string) => seal(s).toString("base64");
const open = (s: string) => unseal(Buffer.from(s, "base64"));

/** The credentials to send with, or null when the gym has not connected (or the sealed token cannot be read). */
export async function getCloudCreds(orgId: string): Promise<CloudCreds | null> {
  const r = await read(orgId);
  if (!r?.token) return null;
  try {
    return { token: open(r.token), phoneNumberId: r.phoneNumberId, wabaId: r.wabaId };
  } catch {
    return null;
  }
}

export async function getCloudInfo(orgId: string): Promise<CloudInfo | null> {
  const r = await read(orgId);
  return r ? { number: r.number, name: r.name, wabaId: r.wabaId, phoneNumberId: r.phoneNumberId, connectedAt: r.connectedAt, templates: r.templates ?? [] } : null;
}

export async function saveCloud(orgId: string, info: CloudInfo, secrets: { token: string; pin: string }) {
  const value = { ...info, token: b64(secrets.token), pin: b64(secrets.pin) };
  await db.setting.upsert({ where: { orgId_key: { orgId, key: CLOUD_KEY } }, create: { orgId, key: CLOUD_KEY, value }, update: { value } });
}

export const removeCloud = (orgId: string) => db.setting.deleteMany({ where: { orgId, key: CLOUD_KEY } });

export async function saveTemplateRows(orgId: string, templates: CloudTemplateRow[]) {
  const r = await read(orgId);
  if (!r) return;
  await db.setting.update({ where: { orgId_key: { orgId, key: CLOUD_KEY } }, data: { value: { ...r, templates } } });
}
