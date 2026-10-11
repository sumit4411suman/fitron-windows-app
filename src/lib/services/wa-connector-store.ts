import "server-only";
import { db } from "@/lib/db";
import { seal, unseal } from "./biometric";

// Where a gym's credentials for the self-hosted WhatsApp connector (whatsapp-connector/) are kept: Setting "whatsapp_connector".
// The gym's connector API key is sealed (AES-256-GCM, the BIOMETRIC_KEY); only the connector's gymId is plain. Like the Cloud
// API connection it is not in EDITABLE_SETTINGS and backups leave it out: a restored gym is provisioned again on first use.
export const CONNECTOR_KEY = "whatsapp_connector";

export type ConnectorGym = { gymId: string; apiKey: string };
type Stored = { gymId: string; key: string; at: string };

const read = async (orgId: string) => ((await db.setting.findUnique({ where: { orgId_key: { orgId, key: CONNECTOR_KEY } } }))?.value as Stored | null) ?? null;

/** The gym's connector credentials, or null when it has none yet (or the sealed key cannot be read). */
export async function getConnectorGym(orgId: string): Promise<ConnectorGym | null> {
  const r = await read(orgId);
  if (!r?.key || !r.gymId) return null;
  try {
    return { gymId: r.gymId, apiKey: unseal(Buffer.from(r.key, "base64")) };
  } catch {
    return null;
  }
}

export async function saveConnectorGym(orgId: string, g: ConnectorGym): Promise<void> {
  const value: Stored = { gymId: g.gymId, key: seal(g.apiKey).toString("base64"), at: new Date().toISOString() };
  await db.setting.upsert({ where: { orgId_key: { orgId, key: CONNECTOR_KEY } }, create: { orgId, key: CONNECTOR_KEY, value }, update: { value } });
}

export const removeConnectorGym = (orgId: string) => db.setting.deleteMany({ where: { orgId, key: CONNECTOR_KEY } });
