import type { Logger } from "../utils/logger.js";

// The connector talks to WhatsApp through this interface only. BaileysProvider and WwebjsProvider are the real ones
// (WA_ENGINE picks); tests use a mock.

export type CloseReason = "loggedOut" | "replaced" | "restartRequired" | "badSession" | "timedOut" | "other";

export type ProviderHandlers = {
  /** A fresh QR string to show (the raw pairing payload, not an image). */
  onQr(qr: string): void;
  /** Logged in and online. */
  onOpen(info: { phone: string | null }): void;
  /** The socket closed. The session decides whether to reconnect. */
  onClose(info: { reason: CloseReason; statusCode: number | undefined; message: string }): void;
  /** A text message from a user chat (never a group). `from` is the sender's number in digits. */
  onIncomingText(msg: { from: string; text: string }): void;
  /** Delivery receipt for a message we sent. */
  onReceipt(r: { providerMessageId: string; status: "DELIVERED" | "READ" | "FAILED" }): void;
  /** Credentials changed; already persisted by the provider. Informational. */
  onCredsSaved?(): void;
};

export type OutgoingMedia = { kind: "document" | "image"; data: Buffer; mimeType: string; fileName?: string; caption?: string };

export interface ProviderClient {
  sendText(jid: string, text: string): Promise<{ providerMessageId: string | null }>;
  sendMedia(jid: string, media: OutgoingMedia): Promise<{ providerMessageId: string | null }>;
  /** The jid to send to when the number is on WhatsApp, else null. */
  resolveRecipient(digits: string): Promise<string | null>;
  /** Sign out of WhatsApp (the phone forgets this device). */
  logout(): Promise<void>;
  /** Close the socket without signing out; a later start() reconnects with the saved credentials. */
  close(): Promise<void>;
}

export type CreateClientOptions = { gymId: string; authDir: string; handlers: ProviderHandlers; logger: Logger };

export interface WhatsAppProvider {
  readonly name: string;
  createClient(opts: CreateClientOptions): Promise<ProviderClient>;
  /** Whether a saved login exists for this folder (restart without QR). */
  hasSavedLogin(authDir: string): Promise<boolean>;
  /** Delete the saved login. */
  clearAuth(authDir: string): Promise<void>;
}
