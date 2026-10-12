import "server-only";
import { graphCall, phoneInfo, type CloudCreds } from "./cloud";
import { getConnectorGym, getConnectorSite, removeConnectorGym, saveConnectorGym } from "@/lib/services/wa-connector-store";
import { gymAccountingOnly, isLocal } from "@/lib/runtime/edition";
import { isNetworkError, offlineMessage, probablyOnline, SERVICE } from "../online";
import { embeddedLogout, embeddedResults, embeddedSend, embeddedStatus, NOT_LINKED_HERE } from "./embedded";

// Sends one WhatsApp message through the configured provider. Secrets come from the server
// environment only; the app stores which mode is on, never the keys.
//   demo       nothing leaves the server; the message is logged
//   cloud      Meta WhatsApp Cloud API (official). Each gym connects its own number (Settings › WhatsApp › Connect) and
//              Fitron sends with that gym's credentials; WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID on the server are
//              only a fallback for one number shared by every gym.
//   connector  the self-hosted WhatsApp Web connector in whatsapp-connector/ (one deployment serves every gym; each gym links
//              its own phone by QR). WA_CONNECTOR_URL is its address and WA_CONNECTOR_KEY its master key, used only to
//              create the gym on the connector the first time; after that Fitron calls it with the gym's own key, kept
//              sealed in the gym's settings (wa-connector-store). FITRON for Windows runs the link itself (embedded.ts:
//              the gym scans a QR code and FITRON keeps the link on the computer); a gym that prefers a connector on
//              another computer enters its address and master key in Settings › WhatsApp › Connector (sealed the same way).

export type WaMode = "demo" | "cloud" | "connector";
export type Outgoing = {
  /** The gym sending it: the connector keeps one WhatsApp link per gym. */
  orgId: string;
  localId: string;
  to: string;
  body: string;
  /** Approved Cloud API template and its body parameters, in order. */
  template?: { name: string; language: string; params: string[]; /** The template has a document header for the invoice PDF. */ docHeader?: boolean };
  /** The gym's own WhatsApp Business connection (cloud mode). Without it the server-wide one is used, if set. */
  cloud?: CloudCreds | null;
  pdf?: { bytes: Uint8Array; filename: string };
};
export type SendResult = { status: "Logged" | "Sent" | "Queued" | "Failed"; providerMessageId?: string; error?: string };

const env = (k: string) => process.env[k]?.trim() || "";
/** Where the connector is, and its master key. */
export type ConnectorSite = { url: string; key: string };
const envSite = (): ConnectorSite => ({ url: env("WA_CONNECTOR_URL").replace(/\/+$/, ""), key: env("WA_CONNECTOR_KEY") });
const NO_SITE: ConnectorSite = { url: "", key: "" };

/** Where this gym's connector is: fitron.in reads the server's settings; FITRON for Windows the gym's own (Settings › WhatsApp). */
export async function connectorSite(orgId: string): Promise<ConnectorSite> {
  if (!isLocal()) return envSite();
  const s = await getConnectorSite(orgId);
  return s ? { url: s.url.replace(/\/+$/, ""), key: s.key } : NO_SITE;
}
/** The server-wide connection, when the Fitron team set one number for every gym (WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID). */
// Never on FITRON for Windows: a gym's members would be messaged from, and visible to, a number that is not the gym's.
const sharedCloud = (): CloudCreds | null => (!gymAccountingOnly() && env("WHATSAPP_TOKEN") && env("WHATSAPP_PHONE_NUMBER_ID") ? { token: env("WHATSAPP_TOKEN"), phoneNumberId: env("WHATSAPP_PHONE_NUMBER_ID"), wabaId: "" } : null);

/** The connector is a separate deployment (whatsapp-connector/); until the Fitron server knows where it is, linking cannot start. */
export const HOSTED_NEEDS_CONNECTOR = "The WhatsApp connector is not set up yet. Deploy whatsapp-connector/ on an always-on server, then set WA_CONNECTOR_URL (its https address, e.g. https://wa-api.fitron.in) and WA_CONNECTOR_KEY (its WA_CONNECTOR_MASTER_KEY) on the Fitron server (whatsapp-connector/README.md).";

/**
 * FITRON for Windows with a connector half entered (an address without a key, or the other way round). With neither,
 * the link built into FITRON is used (builtInLink).
 */
export const LOCAL_NEEDS_CONNECTOR =
  "The connector under Settings › WhatsApp › Connector needs both its address and its key. Press Forget it there to use the WhatsApp link built into FITRON instead.";

/** FITRON for Windows with no connector entered: the gym phone is linked by FITRON itself, on this computer (embedded.ts). */
export const builtInLink = (site: ConnectorSite) => isLocal() && !site.url && !site.key;

/**
 * Why this provider cannot be used, or null. For the connector, `site` is where it is (connectorSite); without it the
 * server's settings are read, which FITRON for Windows never has: use connectorReady there.
 */
export const providerReady = (mode: WaMode, cloud?: CloudCreds | null, site?: ConnectorSite): string | null => {
  if (mode === "cloud" && !cloud && !sharedCloud()) return "This gym has not connected its WhatsApp Business number yet. Press Connect WhatsApp in Settings › WhatsApp.";
  if (mode === "connector") {
    const s = site ?? (isLocal() ? NO_SITE : envSite());
    if (builtInLink(s)) return null;
    if (!s.url || !s.key) return isLocal() ? LOCAL_NEEDS_CONNECTOR : HOSTED_NEEDS_CONNECTOR;
    if (!/^https?:\/\//i.test(s.url)) return isLocal() ? "The connector's address must start with http:// or https://." : "WA_CONNECTOR_URL must start with http:// or https://.";
  }
  return null;
};

/** Whether this gym's connector is set up (not whether it answers): null when it is, else what to do. */
export const connectorReady = async (orgId: string) => providerReady("connector", null, await connectorSite(orgId));

const credsOf = (m: { cloud?: CloudCreds | null }) => m.cloud ?? sharedCloud();

async function sendCloud(m: Outgoing): Promise<SendResult> {
  const c = credsOf(m);
  if (!c) throw new Error(providerReady("cloud") ?? "WhatsApp is not connected.");
  let mediaId: string | undefined;
  if (m.pdf) {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", "application/pdf");
    form.append("file", new Blob([m.pdf.bytes as BlobPart], { type: "application/pdf" }), m.pdf.filename);
    mediaId = (await graphCall<{ id: string }>(`/${c.phoneNumberId}/media`, c.token, { method: "POST", body: form })).id;
  }
  const document = mediaId ? { id: mediaId, filename: m.pdf!.filename } : undefined;
  const payload = m.template
    ? {
        type: "template",
        template: {
          name: m.template.name,
          language: { code: m.template.language },
          // The invoice goes in the template's document header, only when the approved template has one.
          components: [...(document && m.template.docHeader ? [{ type: "header", parameters: [{ type: "document", document }] }] : []), ...(m.template.params.length ? [{ type: "body", parameters: m.template.params.map((text) => ({ type: "text", text: text || "-" })) }] : [])],
        },
      }
    : document
      ? { type: "document", document: { ...document, caption: m.body } }
      : { type: "text", text: { body: m.body, preview_url: true } };
  const json = await graphCall<{ messages?: { id: string }[] }>(`/${c.phoneNumberId}/messages`, c.token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: m.to, ...payload }) });
  return { status: "Sent", providerMessageId: json.messages?.[0]?.id };
}

/** Why a call to the connector at `url` failed, in words a gym owner can act on. */
export function connectorProblem(e: unknown, url = envSite().url): string {
  const code = (e as { cause?: { code?: string } })?.cause?.code;
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof ConnectorError) return e.message;
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return `The connector at ${url} did not answer in time.`;
  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ECONNRESET" || code === "UND_ERR_CONNECT_TIMEOUT" || /fetch failed/i.test(msg))
    return isLocal()
      ? `Nothing is answering at ${url}. Check that the WhatsApp connector is running and that the address under Connector in Settings › WhatsApp is its address.`
      : `Nothing is answering at ${url}. Check that the WhatsApp connector is running (docker compose ps on its server) and that WA_CONNECTOR_URL is its address.`;
  return msg;
}

/** An error the connector answered with: { success: false, error: { code, message } }. */
export class ConnectorError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}

type ApiResponse<T> = { success: true; data: T } | { success: false; error?: { code?: string; message?: string } };

async function rawFetch<T>(site: ConnectorSite, path: string, init: { method: "GET" | "POST"; key: string; body?: unknown; timeout?: number }): Promise<T> {
  const form = init.body instanceof FormData;
  const res = await fetch(`${site.url}${path}`, {
    method: init.method,
    headers: { Authorization: `Bearer ${init.key}`, ...(init.body !== undefined && !form ? { "Content-Type": "application/json" } : {}) },
    body: init.method === "POST" ? (form ? (init.body as FormData) : JSON.stringify(init.body ?? {})) : undefined,
    signal: AbortSignal.timeout(init.timeout ?? 15_000),
  });
  const json = (await res.json().catch(() => ({}))) as ApiResponse<T>;
  if (!res.ok || !json.success) {
    const code = (json as { error?: { code?: string } }).error?.code ?? (res.status === 401 ? "INVALID_API_KEY" : `HTTP_${res.status}`);
    let message = (json as { error?: { message?: string } }).error?.message ?? `Connector returned ${res.status}`;
    if (res.status === 401 && init.key === site.key)
      message = isLocal() ? "The connector refused the key. The key under Connector in Settings › WhatsApp must be the connector's WA_CONNECTOR_MASTER_KEY." : "The connector refused the key. WA_CONNECTOR_KEY on the Fitron server must be the connector's WA_CONNECTOR_MASTER_KEY.";
    throw new ConnectorError(code, message, res.status);
  }
  return json.data;
}

const masterCall = <T>(site: ConnectorSite, path: string, method: "GET" | "POST", body?: unknown) => rawFetch<T>(site, path, { method, key: site.key, body });

type GymPublic = { gymId: string; name: string };

/**
 * The gym's own connector API key, provisioning it on first use: the connector knows the gym by Fitron's orgId
 * (externalId). A gym whose key was lost (restored elsewhere, store wiped) gets its key rotated rather than a second gym.
 */
export async function ensureGym(orgId: string, gymName?: string, site?: ConnectorSite): Promise<{ gymId: string; apiKey: string }> {
  const stored = await getConnectorGym(orgId);
  if (stored) return stored;
  const s = site ?? (await connectorSite(orgId));
  const existing = await masterCall<GymPublic>(s, `/api/v1/gyms/by-external/${encodeURIComponent(orgId)}`, "GET").catch((e: unknown) => {
    if (e instanceof ConnectorError && e.status === 404) return null;
    throw e;
  });
  let gym: { gymId: string; apiKey: string };
  if (existing) gym = await masterCall<{ gymId: string; apiKey: string }>(s, `/api/v1/gyms/${existing.gymId}/rotate-key`, "POST");
  else {
    try {
      gym = await masterCall<{ gymId: string; apiKey: string }>(s, "/api/v1/gyms", "POST", { name: gymName?.trim() || `Fitron gym ${orgId}`, externalId: orgId });
    } catch (e) {
      // Two requests provisioned at once: the other one won, so take over its gym with a fresh key.
      if (!(e instanceof ConnectorError && e.code === "DUPLICATE_REQUEST")) throw e;
      const g = await masterCall<GymPublic>(s, `/api/v1/gyms/by-external/${encodeURIComponent(orgId)}`, "GET");
      gym = await masterCall<{ gymId: string; apiKey: string }>(s, `/api/v1/gyms/${g.gymId}/rotate-key`, "POST");
    }
  }
  await saveConnectorGym(orgId, { gymId: gym.gymId, apiKey: gym.apiKey });
  return { gymId: gym.gymId, apiKey: gym.apiKey };
}

/** A call on behalf of one gym, with its own key. A key the connector no longer accepts is replaced once and the call retried. */
async function gymFetch<T>(orgId: string, path: string, init: { method: "GET" | "POST"; body?: unknown; timeout?: number; gymName?: string }): Promise<T> {
  const site = await connectorSite(orgId);
  const g = await ensureGym(orgId, init.gymName, site);
  try {
    return await rawFetch<T>(site, path, { ...init, key: g.apiKey });
  } catch (e) {
    if (!(e instanceof ConnectorError && e.status === 401)) throw e;
    await removeConnectorGym(orgId);
    const fresh = await ensureGym(orgId, init.gymName, site);
    return rawFetch<T>(site, path, { ...init, key: fresh.apiKey });
  }
}

type ConnectorMessage = { messageId: string; status: string; idempotencyKey: string | null; error: string | null };

async function sendConnector(m: Outgoing, site: ConnectorSite): Promise<SendResult> {
  if (builtInLink(site)) return embeddedSend(m.orgId, m);
  let res: ConnectorMessage;
  if (m.pdf) {
    const form = new FormData();
    form.append("to", m.to);
    form.append("caption", m.body);
    form.append("idempotencyKey", m.localId);
    form.append("category", "TRANSACTIONAL");
    form.append("file", new Blob([m.pdf.bytes as BlobPart], { type: "application/pdf" }), m.pdf.filename);
    res = await gymFetch<ConnectorMessage>(m.orgId, "/api/v1/messages/document", { method: "POST", body: form, timeout: 30_000 });
  } else {
    res = await gymFetch<ConnectorMessage>(m.orgId, "/api/v1/messages/send", { method: "POST", body: { to: m.to, message: m.body, idempotencyKey: m.localId, category: "TRANSACTIONAL" } });
  }
  // The connector sends from a paced queue; the final status is fetched later (refreshQueued).
  return { status: "Queued", providerMessageId: res.messageId };
}

/** Why Meta's WhatsApp Cloud API cannot be used right now on a computer with no internet; null when it can be tried. */
export const cloudOffline = async (feature = "Sending WhatsApp messages through Meta", then?: string) => (isLocal() && !(await probablyOnline(SERVICE.meta)) ? offlineMessage(feature, then) : null);
const KEPT = "The message is kept as Failed: send it again when the computer is online.";

export async function sendWhatsApp(mode: WaMode, m: Outgoing): Promise<SendResult> {
  if (mode === "demo") return { status: "Logged" };
  const site = mode === "connector" ? await connectorSite(m.orgId) : undefined;
  const missing = providerReady(mode, m.cloud, site) ?? (mode === "cloud" ? await cloudOffline(undefined, KEPT) : null);
  if (missing) return { status: "Failed", error: missing };
  try {
    return mode === "cloud" ? await sendCloud(m) : await sendConnector(m, site!);
  } catch (e) {
    if (mode === "connector") return { status: "Failed", error: connectorProblem(e, site?.url) };
    if (isLocal() && isNetworkError(e)) return { status: "Failed", error: offlineMessage("Sending WhatsApp messages through Meta", KEPT) };
    return { status: "Failed", error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Whether the connector can send for this gym now: it answers, and the gym's WhatsApp is linked and online. Null when it
 * can, else why not. Read before a bulk send, so nothing is recorded as sent to a connector that cannot take it.
 */
export async function connectorAnswers(orgId: string): Promise<string | null> {
  const site = await connectorSite(orgId);
  const missing = providerReady("connector", null, site);
  if (missing) return missing;
  try {
    const st = await connectorStatus(orgId);
    const builtIn = builtInLink(site);
    if (st.state === "ready") return null;
    if (st.state === "reconnecting") return builtIn ? "WhatsApp is reconnecting. Try again in a moment." : "WhatsApp is reconnecting on the connector. Try again in a moment.";
    if (builtIn && st.state === "disconnected" && !st.error) return NOT_LINKED_HERE;
    if (st.error) return builtIn ? `WhatsApp has not started on this computer: ${st.error}` : `The connector is running but WhatsApp has not started: ${st.error}`;
    return `WhatsApp on the linked phone is not ready (${st.state}). Link it in Settings › WhatsApp.`;
  } catch (e) {
    return connectorProblem(e, site.url);
  }
}

const STATUS_WORDS: Record<string, string> = { QUEUED: "Queued", PROCESSING: "Queued", SENT: "Sent", DELIVERED: "Delivered", READ: "Read", FAILED: "Failed", CANCELLED: "Failed" };

/** Final statuses for messages the connector queued, by Fitron's own message ids: { id: { status, error } }. null when the connector can't be reached. */
export async function connectorResults(orgId: string, ids: string[]): Promise<Record<string, { status: string; error?: string }> | null> {
  if (!ids.length) return {};
  const site = await connectorSite(orgId);
  if (builtInLink(site)) return embeddedResults(orgId, ids);
  if (providerReady("connector", null, site)) return null;
  const out: Record<string, { status: string; error?: string }> = {};
  try {
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const r = await gymFetch<{ items: ConnectorMessage[] }>(orgId, `/api/v1/messages?idempotencyKeys=${encodeURIComponent(chunk.join(","))}&limit=200`, { method: "GET" });
      for (const m of r.items) if (m.idempotencyKey) out[m.idempotencyKey] = { status: STATUS_WORDS[m.status] ?? m.status, error: m.status === "CANCELLED" ? "Cancelled on the connector" : (m.error ?? undefined) };
    }
    return out;
  } catch {
    return null;
  }
}

export type ConnectorStatus = { state: "ready" | "qr" | "starting" | "reconnecting" | "disconnected"; number?: string; qr?: string; sentToday?: number; cap?: number; queued?: number; error?: string | null };

type StatusData = { status: string; phone: string | null; error: string | null; workerRunning: boolean; today: { sent: number; failed: number }; queued: number; limits: { perDay: number } };

/**
 * The connector's link state for this gym and, while it waits for a scan, the current QR code (data URL). With `start`,
 * a gym that is not linked is asked to connect (the Link WhatsApp dialog); without it the state is only read.
 */
export async function connectorStatus(orgId: string, opts: { start?: boolean; gymName?: string } = {}): Promise<ConnectorStatus> {
  if (builtInLink(await connectorSite(orgId))) return embeddedStatus(orgId, { start: opts.start });
  const d = await gymFetch<StatusData>(orgId, "/api/v1/whatsapp/status", { method: "GET", timeout: 10_000, gymName: opts.gymName });
  const base = { number: d.phone?.replace(/\D/g, "") || undefined, sentToday: d.today?.sent ?? 0, cap: d.limits?.perDay, queued: d.queued ?? 0, error: d.error };
  switch (d.status) {
    case "CONNECTED":
      return { state: "ready", ...base, error: null };
    case "QR_REQUIRED":
    case "CONNECTING": {
      const qr = await gymFetch<{ qr: string | null }>(orgId, "/api/v1/whatsapp/qr", { method: "GET", timeout: 10_000 }).catch(() => null);
      return qr?.qr ? { state: "qr", qr: qr.qr, ...base } : { state: "starting", ...base };
    }
    case "RECONNECTING":
      return { state: "reconnecting", ...base };
    default: {
      if (!opts.start) return { state: "disconnected", ...base };
      if (!d.workerRunning) return { state: "starting", ...base, error: "The connector's WhatsApp worker is not running (docker compose up -d worker on its server)." };
      await gymFetch(orgId, "/api/v1/whatsapp/connect", { method: "POST", timeout: 10_000 });
      return { state: "starting", ...base, error: null };
    }
  }
}

/** Where the app looks for the connector (shown in the Link WhatsApp dialog). */
export const connectorAddress = (site: ConnectorSite = envSite()) => site.url || (isLocal() ? "this computer (built into FITRON)" : "(WA_CONNECTOR_URL not set)");

/** "Unlink": the connector logs the phone out and forgets its login. Errors are ignored; the app forgets the link either way. */
export async function connectorLogout(orgId: string) {
  const site = await connectorSite(orgId);
  if (builtInLink(site)) return embeddedLogout(orgId);
  if (providerReady("connector", null, site)) return;
  try {
    await gymFetch(orgId, "/api/v1/whatsapp/disconnect", { method: "POST", body: { logout: true }, timeout: 10_000 });
  } catch {
    // The connector may already be off.
  }
}

/** Connection check for Settings: who we'd send as, or why we can't. */
export async function providerStatus(mode: WaMode, orgId: string, cloud?: CloudCreds | null): Promise<{ ok: boolean; text: string; qr?: string; number?: string; name?: string }> {
  if (mode === "demo") return { ok: false, text: "WhatsApp is not linked yet. Messages are saved in Fitron but nothing is sent until you link it." };
  const site = mode === "connector" ? await connectorSite(orgId) : undefined;
  const missing = providerReady(mode, cloud, site);
  if (missing) return { ok: false, text: missing };
  if (mode === "cloud") {
    const off = await cloudOffline("Checking the WhatsApp Business number");
    if (off) return { ok: false, text: off };
  }
  try {
    if (mode === "cloud") {
      const j = await phoneInfo(credsOf({ cloud })!);
      return { ok: true, text: `Connected as ${j.verified_name ?? "?"} (${j.display_phone_number ?? "?"}), quality ${j.quality_rating ?? "unknown"}.`, number: j.display_phone_number, name: j.verified_name };
    }
    const st = await connectorStatus(orgId);
    if (st.state === "ready") return { ok: true, text: `Linked to ${st.number ? "+" + st.number : "the gym phone"}. ${st.sentToday ?? 0} of ${st.cap ?? 500} sent today${st.queued ? `, ${st.queued} waiting` : ""}.`, number: st.number };
    if (st.state === "reconnecting") return { ok: false, text: builtInLink(site!) ? "WhatsApp is reconnecting. Messages wait on this computer meanwhile." : "WhatsApp is reconnecting on the connector. Messages queue meanwhile." };
    if (st.error) return { ok: false, text: `Not linked: ${st.error}` };
    return { ok: false, text: `Not linked yet (${st.state}). Press Link WhatsApp and scan the QR from WhatsApp › Linked devices on the gym phone.`, qr: st.qr };
  } catch (e) {
    if (mode === "connector") return { ok: false, text: connectorProblem(e, site?.url) };
    if (isLocal() && isNetworkError(e)) return { ok: false, text: offlineMessage("Checking the WhatsApp Business number") };
    return { ok: false, text: `Couldn't reach the provider: ${e instanceof Error ? e.message : String(e)}` };
  }
}
