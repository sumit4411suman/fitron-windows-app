import "server-only";
import { db } from "@/lib/db";
import { seal, unseal } from "./biometric";

// Where a gym's credentials for the self-hosted WhatsApp connector (whatsapp-connector/) are kept: Setting "whatsapp_connector".
// The gym's connector API key is sealed (AES-256-GCM, the BIOMETRIC_KEY); only the connector's gymId is plain. Like the Cloud
// API connection it is not in EDITABLE_SETTINGS and backups leave it out: a restored gym is provisioned again on first use.
// On FITRON for Windows the same setting also holds where the connector is (its address, and its master key, sealed),
// entered in Settings › WhatsApp: the desktop server has no environment to read them from. The setting never syncs to
// fitron.in (LOCAL_ONLY_SETTINGS in src/lib/sync/entities.ts).
export const CONNECTOR_KEY = "whatsapp_connector";

export type ConnectorGym = { gymId: string; apiKey: string };
export type ConnectorSite = { url: string; key: string };
type Stored = { gymId?: string; key?: string; at?: string; site?: { url: string; key: string; at: string } };

const read = async (orgId: string) => ((await db.setting.findUnique({ where: { orgId_key: { orgId, key: CONNECTOR_KEY } } }))?.value as Stored | null) ?? null;
const write = (orgId: string, value: Stored) => db.setting.upsert({ where: { orgId_key: { orgId, key: CONNECTOR_KEY } }, create: { orgId, key: CONNECTOR_KEY, value }, update: { value } });
const open = (sealed: string) => {
  try {
    return unseal(Buffer.from(sealed, "base64"));
  } catch {
    return null;
  }
};

/** The gym's connector credentials, or null when it has none yet (or the sealed key cannot be read). */
export async function getConnectorGym(orgId: string): Promise<ConnectorGym | null> {
  const r = await read(orgId);
  if (!r?.key || !r.gymId) return null;
  const apiKey = open(r.key);
  return apiKey ? { gymId: r.gymId, apiKey } : null;
}

export async function saveConnectorGym(orgId: string, g: ConnectorGym): Promise<void> {
  const r = await read(orgId);
  await write(orgId, { ...(r?.site ? { site: r.site } : {}), gymId: g.gymId, key: seal(g.apiKey).toString("base64"), at: new Date().toISOString() });
}

/** Forgets the gym's connector key (it is provisioned again on next use); where the connector is stays. */
export async function removeConnectorGym(orgId: string): Promise<void> {
  const r = await read(orgId);
  if (r?.site) await write(orgId, { site: r.site });
  else await db.setting.deleteMany({ where: { orgId, key: CONNECTOR_KEY } });
}

/** FITRON for Windows: where the gym's connector is, or null when it was never entered (or its key cannot be read here). */
export async function getConnectorSite(orgId: string): Promise<ConnectorSite | null> {
  const s = (await read(orgId))?.site;
  if (!s?.url || !s.key) return null;
  const key = open(s.key);
  return key ? { url: s.url, key } : null;
}

/** Whether an address is saved, and which (never the key): for the settings screen. */
export async function connectorSiteInfo(orgId: string): Promise<{ url: string; at: string } | null> {
  const s = (await read(orgId))?.site;
  return s?.url ? { url: s.url, at: s.at } : null;
}

/**
 * Saves where the connector is (null: forget it). A different connector knows the gym under another key, so the gym's
 * stored key goes with a change of address and is provisioned there on first use.
 */
export async function saveConnectorSite(orgId: string, site: ConnectorSite | null): Promise<void> {
  const r = await read(orgId);
  const same = !!site && r?.site?.url === site.url;
  const gym = same && r?.gymId && r.key ? { gymId: r.gymId, key: r.key, at: r.at } : {};
  if (!site) {
    if (Object.keys(gym).length) await write(orgId, gym);
    else await db.setting.deleteMany({ where: { orgId, key: CONNECTOR_KEY } });
    return;
  }
  await write(orgId, { ...gym, site: { url: site.url, key: seal(site.key).toString("base64"), at: new Date().toISOString() } });
}
