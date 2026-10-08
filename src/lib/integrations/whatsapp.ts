import "server-only";
import { graphCall, phoneInfo, type CloudCreds } from "./whatsapp-cloud";

// Sends one WhatsApp message through the configured provider. Secrets come from the server
// environment only; the app stores which mode is on, never the keys.
//   demo       nothing leaves the server; the message is logged
//   cloud      Meta WhatsApp Cloud API (official). Each gym connects its own number (Settings › WhatsApp › Connect) and
//              Fitron sends with that gym's credentials; WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID on the server are
//              only a fallback for one number shared by every gym.
//   connector  the linked-phone connector in prototype/connector. WA_CONNECTOR_URL and WA_CONNECTOR_KEY say where it is and
//              its key; without them the app looks for it on this computer (http://127.0.0.1:3131, key fitron-local),
//              which is what the connector's double-click start files use out of the box.

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
const DEFAULT_CONNECTOR_URL = "http://127.0.0.1:3131";
const DEFAULT_CONNECTOR_KEY = "fitron-local";
const connectorUrl = () => (env("WA_CONNECTOR_URL") || DEFAULT_CONNECTOR_URL).replace(/\/+$/, "");
const connectorKey = () => env("WA_CONNECTOR_KEY") || DEFAULT_CONNECTOR_KEY;
/** The server-wide connection, when the Fitron team set one number for every gym (WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID). */
const sharedCloud = (): CloudCreds | null => (env("WHATSAPP_TOKEN") && env("WHATSAPP_PHONE_NUMBER_ID") ? { token: env("WHATSAPP_TOKEN"), phoneNumberId: env("WHATSAPP_PHONE_NUMBER_ID"), wabaId: "" } : null);

/** Fitron on Vercel cannot reach a connector on the gym PC (127.0.0.1 is Vercel's own machine): the connector must be hosted and WA_CONNECTOR_URL set. */
export const HOSTED_NEEDS_CONNECTOR = "Fitron is hosted online, so it cannot reach a connector on your own computer. Run the Fitron connector on an always-on server, then set WA_CONNECTOR_URL and WA_CONNECTOR_KEY on the Fitron server (prototype/connector/README.md).";

export const providerReady = (mode: WaMode, cloud?: CloudCreds | null): string | null => {
  if (mode === "cloud" && !cloud && !sharedCloud()) return "This gym has not connected its WhatsApp Business number yet. Press Connect WhatsApp in Settings › WhatsApp.";
  if (mode === "connector" && !env("WA_CONNECTOR_URL") && env("VERCEL")) return HOSTED_NEEDS_CONNECTOR;
  if (mode === "connector" && env("WA_CONNECTOR_URL") && !/^https?:\/\//i.test(env("WA_CONNECTOR_URL"))) return "WA_CONNECTOR_URL must start with http:// or https://.";
  return null;
};

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

/** Why a call to the connector failed, in words a gym owner can act on. */
export function connectorProblem(e: unknown): string {
  const url = connectorUrl();
  const code = (e as { cause?: { code?: string } })?.cause?.code;
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return `The connector at ${url} did not answer in time.`;
  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ECONNRESET" || code === "UND_ERR_CONNECT_TIMEOUT" || /fetch failed/i.test(msg))
    return `Nothing is answering at ${url}. Start the connector and keep its window open${env("WA_CONNECTOR_URL") ? "" : " (the app looks for it on the same computer unless WA_CONNECTOR_URL is set on the server)"}.`;
  return msg;
}

async function connectorFetch(orgId: string, path: string, init: { method: "GET" | "POST"; body?: unknown; timeout?: number }) {
  const res = await fetch(`${connectorUrl()}${path}`, {
    method: init.method,
    headers: { "Content-Type": "application/json", "x-fitron-key": connectorKey(), "x-fitron-org": orgId },
    body: init.method === "POST" ? JSON.stringify(init.body ?? {}) : undefined,
    signal: AbortSignal.timeout(init.timeout ?? 15_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401) throw new Error("The connector refused the key. WA_CONNECTOR_KEY must be the same as the connector's FITRON_KEY (leave both empty to use the built-in key on one computer).");
  if (!res.ok) throw new Error(String(json.error ?? `Connector returned ${res.status}`));
  return json;
}

const connectorCall = (orgId: string, path: string, body: unknown) => connectorFetch(orgId, path, { method: "POST", body });

async function sendConnector(m: Outgoing): Promise<SendResult> {
  const media = m.pdf ? { mimetype: "application/pdf", data: Buffer.from(m.pdf.bytes).toString("base64"), filename: m.pdf.filename } : undefined;
  await connectorCall(m.orgId, "/send", { id: m.localId, to: m.to, text: m.body, media });
  // The connector sends from a queue with 8–15 s gaps; the final status is fetched later.
  return { status: "Queued", providerMessageId: m.localId };
}

export async function sendWhatsApp(mode: WaMode, m: Outgoing): Promise<SendResult> {
  if (mode === "demo") return { status: "Logged" };
  const missing = providerReady(mode, m.cloud);
  if (missing) return { status: "Failed", error: missing };
  try {
    return mode === "cloud" ? await sendCloud(m) : await sendConnector(m);
  } catch (e) {
    return { status: "Failed", error: mode === "connector" ? connectorProblem(e) : e instanceof Error ? e.message : String(e) };
  }
}

/** Final statuses for messages the connector queued: { id: { status, error } }. null when the connector can't be reached. */
export async function connectorResults(orgId: string, ids: string[]): Promise<Record<string, { status: string; error?: string }> | null> {
  if (!ids.length) return {};
  if (providerReady("connector")) return null;
  try {
    return (await connectorCall(orgId, "/results", { ids })) as Record<string, { status: string; error?: string }>;
  } catch {
    return null;
  }
}

export type ConnectorStatus = { state: string; number?: string; qr?: string; sentToday?: number; cap?: number; queued?: number; error?: string | null };

/** The connector's link state and, while it waits for a scan, the current QR code (data URL). */
export async function connectorStatus(orgId: string): Promise<ConnectorStatus> {
  const st = (await connectorFetch(orgId, "/status", { method: "GET", timeout: 10_000 })) as ConnectorStatus;
  if (st.state === "ready") return st;
  const qr = (await connectorFetch(orgId, "/qr", { method: "GET", timeout: 10_000 })) as { qr?: string; state?: string };
  return { ...st, state: qr.state ?? st.state ?? "starting", qr: qr.qr ?? undefined };
}

/** Where the app looks for the connector (shown in the Link WhatsApp dialog). */
export const connectorAddress = () => connectorUrl();

/** "Unlink": the connector signs out of WhatsApp. Errors are ignored; the app forgets the link either way. */
export async function connectorLogout(orgId: string) {
  if (providerReady("connector")) return;
  try {
    await connectorFetch(orgId, "/logout", { method: "POST", timeout: 10_000 });
  } catch {
    // The connector may already be off.
  }
}

/** Connection check for Settings: who we'd send as, or why we can't. */
export async function providerStatus(mode: WaMode, orgId: string, cloud?: CloudCreds | null): Promise<{ ok: boolean; text: string; qr?: string; number?: string; name?: string }> {
  if (mode === "demo") return { ok: false, text: "WhatsApp is not linked yet. Messages are saved in Fitron but nothing is sent until you link it." };
  const missing = providerReady(mode, cloud);
  if (missing) return { ok: false, text: missing };
  try {
    if (mode === "cloud") {
      const j = await phoneInfo(credsOf({ cloud })!);
      return { ok: true, text: `Connected as ${j.verified_name ?? "?"} (${j.display_phone_number ?? "?"}), quality ${j.quality_rating ?? "unknown"}.`, number: j.display_phone_number, name: j.verified_name };
    }
    const st = await connectorStatus(orgId);
    if (st.state === "ready") return { ok: true, text: `Linked to ${st.number ?? "the gym phone"}. ${st.sentToday ?? 0} of ${st.cap ?? 250} sent today.` };
    if (st.error) return { ok: false, text: `The connector is running but WhatsApp has not started: ${st.error}` };
    return { ok: false, text: `Not linked yet (${st.state}). Scan the QR from WhatsApp › Linked devices on the gym phone.`, qr: st.qr };
  } catch (e) {
    return { ok: false, text: mode === "connector" ? connectorProblem(e) : `Couldn't reach the provider: ${e instanceof Error ? e.message : String(e)}` };
  }
}
