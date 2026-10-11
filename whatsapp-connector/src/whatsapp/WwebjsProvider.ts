import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Client, Message } from "whatsapp-web.js";
import type { CloseReason, CreateClientOptions, OutgoingMedia, ProviderClient, WhatsAppProvider } from "./provider.js";

// WhatsApp Web through whatsapp-web.js (wwebjs/whatsapp-web.js): a headless Chromium per gym with WhatsApp Web open,
// driven by Puppeteer. Heavier than Baileys (roughly 300-500 MB of RAM per connected gym) but it is the real WhatsApp
// Web client. Picked with WA_ENGINE=wwebjs.
//
// The login is Chromium's own profile (LocalAuth), kept in SESSION_STORAGE_PATH/<gymId>/session with 0700 permissions.
// Unlike the Baileys files it is not encrypted with SESSION_ENCRYPTION_KEY: Chromium has to read it directly. Protect
// the volume it lives on.

export type WwebjsOptions = {
  /** The Chromium to launch (the Docker image installs one at /usr/bin/chromium-browser). Empty: Puppeteer's own. */
  executablePath?: string;
  /** QR codes WhatsApp Web shows (one every ~20 s) before the client gives up; the session then decides whether to retry. */
  qrMaxRetries?: number;
};

/** The folder LocalAuth keeps Chromium's profile in, under the gym's auth folder. */
const profileDir = (authDir: string) => join(authDir, "session");
/** Written once WhatsApp Web is signed in: Chromium creates its profile before anyone scans, so the folder alone proves nothing. */
const linkedMarker = (authDir: string) => join(authDir, "linked");

// "LOGOUT" is the phone removing this linked device; UNPAIRED* and the TOS blocks mean the login is gone for good.
const closeReason = (reason: string): CloseReason => {
  switch (reason) {
    case "LOGOUT":
    case "UNPAIRED":
    case "UNPAIRED_IDLE":
    case "TOS_BLOCK":
    case "SMB_TOS_BLOCK":
      return "loggedOut";
    case "CONFLICT":
      return "replaced";
    case "TIMEOUT":
      return "timedOut";
    default:
      return "other";
  }
};

// MessageAck: -1 error, 0 pending, 1 server, 2 device, 3 read, 4 played.
const receiptStatus = (ack: number): "DELIVERED" | "READ" | "FAILED" | null => (ack === 2 ? "DELIVERED" : ack === 3 || ack === 4 ? "READ" : ack === -1 ? "FAILED" : null);

/** Digits of a user chat id (919876543210@c.us), or null for groups, broadcasts and anything else. */
const digitsOf = (id: string | undefined): string | null => {
  const m = /^(\d{6,20})@c\.us$/.exec(id ?? "");
  return m ? m[1]! : null;
};

/** The sender's number. Newer WhatsApp Web addresses some chats by a private id (…@lid); the contact then carries the number. */
async function senderOf(msg: Message): Promise<string | null> {
  if (msg.from.endsWith("@g.us") || msg.from === "status@broadcast" || msg.from.endsWith("@newsletter")) return null;
  const direct = digitsOf(msg.from);
  if (direct) return direct;
  try {
    const c = await msg.getContact();
    return c.number && /^\d{6,20}$/.test(c.number) ? c.number : null;
  } catch {
    return null;
  }
}

export class WwebjsProvider implements WhatsAppProvider {
  readonly name = "wwebjs";
  constructor(private readonly opts: WwebjsOptions = {}) {}

  async hasSavedLogin(authDir: string): Promise<boolean> {
    const [profile, marker] = await Promise.all([stat(profileDir(authDir)).catch(() => null), stat(linkedMarker(authDir)).catch(() => null)]);
    return !!profile?.isDirectory() && !!marker?.isFile();
  }

  clearAuth(authDir: string): Promise<void> {
    return rm(authDir, { recursive: true, force: true });
  }

  async createClient({ gymId, authDir, handlers, logger }: CreateClientOptions): Promise<ProviderClient> {
    // Loaded only when this engine is picked, so the Baileys engine never pulls Puppeteer in.
    const { default: wwebjs } = await import("whatsapp-web.js");
    const log = logger.child({ gymId, provider: "wwebjs" });
    await mkdir(authDir, { recursive: true, mode: 0o700 });

    const client: Client = new wwebjs.Client({
      authStrategy: new wwebjs.LocalAuth({ dataPath: authDir }),
      qrMaxRetries: this.opts.qrMaxRetries ?? 5,
      puppeteer: {
        headless: true,
        ...(this.opts.executablePath ? { executablePath: this.opts.executablePath } : {}),
        // Small servers: no GPU, no /dev/shm (Docker gives it 64 MB), no sandbox (the container is the sandbox).
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-extensions", "--no-first-run", "--no-default-browser-check", "--mute-audio"],
      },
    });

    // The browser is shut down before the session hears about a close, so a disconnected gym never leaves Chromium running.
    let done = false;
    const finish = async (reason: CloseReason, message: string) => {
      if (done) return;
      done = true;
      client.removeAllListeners();
      await client.destroy().catch(() => undefined);
      handlers.onClose({ reason, statusCode: undefined, message });
    };

    client.on("qr", (qr: string) => handlers.onQr(qr));
    client.on("ready", () => {
      void writeFile(linkedMarker(authDir), new Date().toISOString(), { mode: 0o600 }).catch((err: Error) => log.warn({ err: err.message }, "could not mark the login as saved"));
      handlers.onOpen({ phone: client.info?.wid?.user ?? null });
    });
    client.on("auth_failure", (message: string) => void finish("badSession", message || "WhatsApp rejected the login"));
    client.on("disconnected", (reason: string) => void finish(closeReason(String(reason)), `WhatsApp Web disconnected (${reason})`));
    client.on("message", (msg: Message) => {
      if (msg.fromMe || msg.type !== "chat" || !msg.body) return;
      void senderOf(msg).then((from) => {
        if (from) handlers.onIncomingText({ from, text: msg.body });
      });
    });
    client.on("message_ack", (msg: Message, ack: number) => {
      if (!msg.fromMe) return;
      const status = receiptStatus(ack);
      if (status) handlers.onReceipt({ providerMessageId: msg.id._serialized, status });
    });

    // Chromium failing to start (missing library, out of memory) is reported like a dropped connection: the session
    // retries with backoff and shows the error.
    client.initialize().catch((err: Error) => {
      log.error({ err: err.message }, "WhatsApp Web did not start");
      void finish("other", `WhatsApp Web did not start: ${err.message}`);
    });

    const sent = (m: Message) => ({ providerMessageId: m?.id?._serialized ?? null });

    return {
      sendText: async (jid, text) => sent(await client.sendMessage(jid, text)),
      sendMedia: async (jid, media: OutgoingMedia) => {
        const file = new wwebjs.MessageMedia(media.mimeType, media.data.toString("base64"), media.fileName ?? (media.kind === "document" ? "document" : null));
        return sent(await client.sendMessage(jid, file, { ...(media.caption ? { caption: media.caption } : {}), sendMediaAsDocument: media.kind === "document" }));
      },
      resolveRecipient: async (digits) => (await client.getNumberId(digits))?._serialized ?? null,
      logout: async () => {
        done = true;
        client.removeAllListeners();
        try {
          await client.logout();
        } finally {
          await client.destroy().catch(() => undefined);
          await rm(authDir, { recursive: true, force: true });
        }
      },
      close: async () => {
        done = true;
        client.removeAllListeners();
        await client.destroy().catch(() => undefined);
      },
    };
  }
}
