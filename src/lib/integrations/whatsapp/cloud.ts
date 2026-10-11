import "server-only";
import { PDFDocument } from "pdf-lib";
import type { MetaTemplate } from "@/lib/domain/wa-meta";

// Talking to Meta for the official WhatsApp Business API, one WhatsApp Business account per gym. The gym owner connects
// her own number with Meta's "Connect" pop-up (Embedded Signup); Fitron keeps what that returns and sends from her number.
// Server settings (Fitron's own Meta app, set up once by the Fitron team):
//   META_APP_ID, META_ES_CONFIG_ID   the app and its Embedded Signup configuration
//   WHATSAPP_APP_SECRET              the app secret (also signs the delivery webhook)
//   WHATSAPP_VERIFY_TOKEN            for the webhook, https://<domain>/api/webhooks/whatsapp, set once at app level

/** One gym's WhatsApp Business connection. The token is the gym's own business token; it never leaves the server. */
export type CloudCreds = { phoneNumberId: string; wabaId: string; token: string };

const env = (k: string) => process.env[k]?.trim() || "";
export const graphVersion = () => env("WHATSAPP_API_VERSION") || "v21.0";
export const graph = () => `https://graph.facebook.com/${graphVersion()}`;

/** What the Connect button needs, or null while the Fitron team has not set the Meta app up on this server. */
export function signupConfig() {
  const appId = env("META_APP_ID");
  const configId = env("META_ES_CONFIG_ID");
  return appId && configId && env("WHATSAPP_APP_SECRET") ? { appId, configId, version: graphVersion() } : null;
}

type Init = Omit<RequestInit, "headers"> & { headers?: Record<string, string>; timeout?: number };

/** One call to Meta's Graph API with a token. Throws Meta's own message, which is written for the person to read. */
export async function graphCall<T = Record<string, unknown>>(path: string, token: string, init: Init = {}): Promise<T> {
  const { timeout, headers, ...rest } = init;
  const res = await fetch(path.startsWith("http") ? path : `${graph()}${path}`, { ...rest, headers: { Authorization: `Bearer ${token}`, ...(headers ?? {}) }, signal: AbortSignal.timeout(timeout ?? 15_000) });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; error_user_msg?: string } };
  if (!res.ok) throw new Error(json.error?.error_user_msg ?? json.error?.message ?? `WhatsApp API returned ${res.status}`);
  return json as T;
}

/** The Connect pop-up hands back a short-lived code; this turns it into the gym's business token. */
export async function exchangeCode(code: string): Promise<string> {
  const q = new URLSearchParams({ client_id: env("META_APP_ID"), client_secret: env("WHATSAPP_APP_SECRET"), code });
  const res = await fetch(`${graph()}/oauth/access_token?${q}`, { signal: AbortSignal.timeout(15_000) });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; error?: { message?: string } };
  if (!res.ok || !json.access_token) throw new Error(json.error?.message ?? "Meta did not accept the connection. Press Connect and try again.");
  return json.access_token;
}

export type PhoneInfo = { display_phone_number?: string; verified_name?: string; quality_rating?: string };
export const phoneInfo = (c: CloudCreds) => graphCall<PhoneInfo>(`/${c.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`, c.token, { timeout: 10_000 });

/** Turns the number on for the Cloud API. `pin` becomes its two-step verification PIN (kept sealed, needed to move the number later). */
export const registerNumber = (c: CloudCreds, pin: string) =>
  graphCall(`/${c.phoneNumberId}/register`, c.token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", pin }) });

/** Has Meta send this gym's delivery receipts (sent, delivered, read, failed) to Fitron's webhook. */
export const subscribeApp = (c: CloudCreds) => graphCall(`/${c.wabaId}/subscribed_apps`, c.token, { method: "POST" });

/** A one-page sample PDF uploaded to Meta, which wants an example document for templates that carry an invoice. */
async function sampleDocumentHandle(token: string): Promise<string> {
  const pdf = await PDFDocument.create();
  pdf.addPage([400, 200]);
  const bytes = await pdf.save();
  const q = new URLSearchParams({ file_name: "invoice.pdf", file_length: String(bytes.length), file_type: "application/pdf" });
  const session = await graphCall<{ id: string }>(`${graph()}/${env("META_APP_ID")}/uploads?${q}`, token, { method: "POST" });
  const done = await fetch(`${graph()}/${session.id}`, { method: "POST", headers: { Authorization: `OAuth ${token}`, file_offset: "0" }, body: bytes as BodyInit, signal: AbortSignal.timeout(20_000) });
  const json = (await done.json().catch(() => ({}))) as { h?: string; error?: { message?: string } };
  if (!done.ok || !json.h) throw new Error(json.error?.message ?? "Meta did not accept the sample document.");
  return json.h;
}

export type SubmitResult = { key: string; name: string; ok: boolean; error?: string };

/**
 * Submits templates to the gym's WhatsApp Business account. Each is independent: one that Meta refuses (or one that is already
 * there) never stops the rest. Approval takes Meta minutes to a day; until then messages that use the template cannot go out.
 */
export async function submitTemplates(c: CloudCreds, templates: MetaTemplate[]): Promise<SubmitResult[]> {
  let handle: Promise<string> | null = null;
  const out: SubmitResult[] = [];
  for (const t of templates) {
    try {
      const header = t.docHeader ? [{ type: "HEADER", format: "DOCUMENT", example: { header_handle: [await (handle ??= sampleDocumentHandle(c.token))] } }] : [];
      const body = { type: "BODY", text: t.text, ...(t.vars.length ? { example: { body_text: [t.examples] } } : {}) };
      await graphCall(`/${c.wabaId}/message_templates`, c.token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: t.name, language: t.language, category: t.category, components: [...header, body] }),
        timeout: 20_000,
      });
      out.push({ key: t.key, name: t.name, ok: true });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      // Already submitted on an earlier connect: nothing to do.
      out.push({ key: t.key, name: t.name, ok: /already exist/i.test(error), error: /already exist/i.test(error) ? undefined : error });
    }
  }
  return out;
}

export type TemplateStatus = { name: string; language: string; status: string; reason?: string };

/** Where each of the gym's templates stands with Meta: APPROVED, PENDING, REJECTED… */
export async function templateStatuses(c: CloudCreds): Promise<TemplateStatus[]> {
  const j = await graphCall<{ data?: { name: string; language: string; status: string; rejected_reason?: string }[] }>(`/${c.wabaId}/message_templates?fields=name,status,language,rejected_reason&limit=200`, c.token, { timeout: 10_000 });
  return (j.data ?? []).map((t) => ({ name: t.name, language: t.language, status: t.status, reason: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : undefined }));
}
