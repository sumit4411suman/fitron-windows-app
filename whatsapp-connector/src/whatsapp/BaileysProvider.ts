import { Boom } from "@hapi/boom";
import { Browsers, DisconnectReason, fetchLatestBaileysVersion, jidNormalizedUser, makeCacheableSignalKeyStore, makeWASocket, type AnyMessageContent, type WAMessageUpdate, type WASocket, type WAVersion } from "baileys";
import pino from "pino";
import { fromJid, toJid } from "../utils/phoneNumber.js";
import { hasSavedCredentials, removeAuthFolder, useEncryptedFileAuthState } from "./authState.js";
import type { CloseReason, CreateClientOptions, OutgoingMedia, ProviderClient, WhatsAppProvider } from "./provider.js";

// WhatsApp Web through Baileys (WhiskeySockets/Baileys, a maintained WebSocket implementation of the multi-device
// protocol; no Chromium). One socket per gym. The library's own logger is kept silent: its debug output contains
// message contents and key material.

const closeReason = (statusCode: number | undefined): CloseReason => {
  switch (statusCode) {
    case DisconnectReason.loggedOut:
    case DisconnectReason.forbidden:
      return "loggedOut";
    case DisconnectReason.connectionReplaced:
      return "replaced";
    case DisconnectReason.restartRequired:
      return "restartRequired";
    case DisconnectReason.badSession:
      return "badSession";
    case DisconnectReason.timedOut:
    case DisconnectReason.connectionLost:
      return "timedOut";
    default:
      return "other";
  }
};

let cachedVersion: WAVersion | undefined;
async function waVersion(): Promise<WAVersion | undefined> {
  if (cachedVersion) return cachedVersion;
  try {
    const v = await fetchLatestBaileysVersion();
    if (v.isLatest || v.version) cachedVersion = v.version;
  } catch {
    // The library's built-in default version is used.
  }
  return cachedVersion;
}

// Baileys reports message status with WebMessageInfo.Status: 0 ERROR, 1 PENDING, 2 SERVER_ACK, 3 DELIVERY_ACK, 4 READ, 5 PLAYED.
const receiptStatus = (s: number | null | undefined): "DELIVERED" | "READ" | "FAILED" | null => (s === 3 ? "DELIVERED" : s === 4 || s === 5 ? "READ" : s === 0 ? "FAILED" : null);

export class BaileysProvider implements WhatsAppProvider {
  readonly name = "baileys";
  constructor(private readonly encryptionKey: Buffer) {}

  hasSavedLogin(authDir: string): Promise<boolean> {
    return hasSavedCredentials(authDir, this.encryptionKey);
  }

  clearAuth(authDir: string): Promise<void> {
    return removeAuthFolder(authDir);
  }

  async createClient({ gymId, authDir, handlers, logger }: CreateClientOptions): Promise<ProviderClient> {
    const auth = await useEncryptedFileAuthState(authDir, this.encryptionKey);
    const silent = pino({ level: "silent" });
    const version = await waVersion();
    const sock: WASocket = makeWASocket({
      auth: { creds: auth.state.creds, keys: makeCacheableSignalKeyStore(auth.state.keys, silent) },
      logger: silent,
      browser: Browsers.ubuntu("Chrome"),
      ...(version ? { version } : {}),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      generateHighQualityLinkPreview: false,
      connectTimeoutMs: 30_000,
      defaultQueryTimeoutMs: 60_000,
      keepAliveIntervalMs: 25_000,
      qrTimeout: 60_000,
    });
    const log = logger.child({ gymId, provider: "baileys" });

    sock.ev.on("creds.update", () => {
      auth.saveCreds().then(() => handlers.onCredsSaved?.()).catch((err: unknown) => log.error({ err: (err as Error).message }, "could not save credentials"));
    });

    sock.ev.on("connection.update", (u) => {
      if (u.qr) handlers.onQr(u.qr);
      if (u.connection === "open") {
        const phone = fromJid(jidNormalizedUser(sock.user?.id));
        handlers.onOpen({ phone });
      }
      if (u.connection === "close") {
        const err = u.lastDisconnect?.error;
        const statusCode = err instanceof Boom ? err.output.statusCode : (err as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
        handlers.onClose({ reason: closeReason(statusCode), statusCode, message: err?.message ?? "connection closed" });
      }
    });

    sock.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify") return;
      for (const m of messages) {
        if (m.key.fromMe) continue;
        const jid = m.key.remoteJid ?? "";
        // Baileys 7 may address a chat by LID; the phone-number jid then comes in remoteJidAlt.
        const from = fromJid(jid) ?? fromJid(m.key.remoteJidAlt);
        if (!from) continue; // groups, broadcasts, unknown LIDs
        const text = m.message?.conversation ?? m.message?.extendedTextMessage?.text ?? "";
        if (text) handlers.onIncomingText({ from, text });
      }
    });

    sock.ev.on("messages.update", (updates: WAMessageUpdate[]) => {
      for (const { key, update } of updates) {
        if (!key.fromMe || !key.id) continue;
        const status = receiptStatus(update.status);
        if (status) handlers.onReceipt({ providerMessageId: key.id, status });
      }
    });

    const send = async (jid: string, content: AnyMessageContent) => {
      const res = await sock.sendMessage(jid, content);
      return { providerMessageId: res?.key?.id ?? null };
    };

    return {
      sendText: (jid, text) => send(jid, { text }),
      sendMedia: (jid, media: OutgoingMedia) =>
        media.kind === "image"
          ? send(jid, { image: media.data, mimetype: media.mimeType, ...(media.caption ? { caption: media.caption } : {}) })
          : send(jid, { document: media.data, mimetype: media.mimeType, fileName: media.fileName ?? "document", ...(media.caption ? { caption: media.caption } : {}) }),
      resolveRecipient: async (digits) => {
        const res = await sock.onWhatsApp(digits);
        const hit = res?.find((r) => r.exists);
        return hit ? hit.jid || toJid(digits) : null;
      },
      logout: async () => {
        try {
          await sock.logout();
        } finally {
          sock.ev.removeAllListeners("connection.update");
          await removeAuthFolder(authDir);
        }
      },
      close: async () => {
        sock.ev.removeAllListeners("connection.update");
        sock.ev.removeAllListeners("messages.upsert");
        sock.ev.removeAllListeners("messages.update");
        await sock.end(undefined);
      },
    };
  }
}
