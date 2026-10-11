import type { MessageCategory, MessageType, PrismaClient } from "../generated/prisma/index.js";
import { ConsentService } from "../services/ConsentService.js";
import { MessageLogService, toMessageView, type MessageView } from "../services/MessageLogService.js";
import { normalizePhone } from "../utils/phoneNumber.js";
import { AppError } from "../utils/errors.js";
import type { MessageQueue } from "../queue/messageQueue.js";
import { SessionStore } from "./SessionStore.js";
import type { MediaService } from "./MediaService.js";

export type SendInput = {
  gymId: string;
  to: string;
  message: string;
  category?: MessageCategory;
  memberId?: string;
  templateKey?: string;
  idempotencyKey?: string;
  /** For document/image sends: the uploaded file. */
  file?: { buffer: Buffer; mimeType: string; fileName: string };
};

export type SendOptions = { defaultCountry: string; maxQueuePerGym: number; maxTextLength?: number };

/** Sessions that accept new messages: connected, or only briefly offline. */
const ACCEPTING = new Set(["CONNECTED", "RECONNECTING", "CONNECTING"]);

/**
 * API -> validate -> consent -> queue size -> log row -> queue job. The worker does the rest.
 * Idempotent per gym on idempotencyKey: the same key returns the first message instead of sending twice.
 */
export class MessageService {
  private readonly sessions: SessionStore;
  constructor(
    db: PrismaClient,
    private readonly consent: ConsentService,
    private readonly log: MessageLogService,
    private readonly queue: MessageQueue,
    private readonly media: MediaService,
    private readonly opts: SendOptions,
  ) {
    this.sessions = new SessionStore(db);
  }

  async send(input: SendInput): Promise<{ message: MessageView; duplicate: boolean }> {
    const text = (input.message ?? "").trim();
    const max = this.opts.maxTextLength ?? 4096;
    if (!text && !input.file) throw new AppError("VALIDATION_ERROR", "message must not be empty.");
    if (text.length > max) throw new AppError("VALIDATION_ERROR", `message is longer than ${max} characters.`);
    const phone = normalizePhone(input.to, this.opts.defaultCountry);
    const category: MessageCategory = input.category ?? "TRANSACTIONAL";

    if (input.idempotencyKey) {
      const existing = await this.log.findByIdempotencyKey(input.gymId, input.idempotencyKey);
      if (existing) return { message: toMessageView(existing), duplicate: true };
    }

    await this.consent.assertAllowed(input.gymId, phone.digits, category);

    const session = await this.sessions.get(input.gymId);
    if (!ACCEPTING.has(session.status)) {
      if (session.status === "SESSION_EXPIRED") throw new AppError("SESSION_EXPIRED", "The WhatsApp session expired. Connect again and scan a new QR code.");
      throw new AppError("WHATSAPP_NOT_CONNECTED", "WhatsApp is not connected.");
    }

    const queued = await this.queue.sizeForGym(input.gymId);
    if (queued >= this.opts.maxQueuePerGym) throw new AppError("MESSAGE_QUEUE_FULL", `This gym already has ${queued} messages waiting (limit ${this.opts.maxQueuePerGym}).`);

    let messageType: MessageType = "TEXT";
    let validated: { mimeType: string; messageType: MessageType; fileName: string } | null = null;
    if (input.file) {
      validated = this.media.validate(input.file);
      messageType = validated.messageType;
    }

    let row;
    try {
      row = await this.log.create({ gymId: input.gymId, recipient: phone.digits, message: text, messageType, category, memberId: input.memberId ?? null, templateKey: input.templateKey ?? null, idempotencyKey: input.idempotencyKey ?? null, mediaName: validated?.fileName ?? null, mediaMimeType: validated?.mimeType ?? null });
    } catch (err) {
      // Two identical requests raced on the idempotency key: return the winner.
      if (input.idempotencyKey && (err as { code?: string }).code === "P2002") {
        const existing = await this.log.findByIdempotencyKey(input.gymId, input.idempotencyKey);
        if (existing) return { message: toMessageView(existing), duplicate: true };
      }
      throw err;
    }

    if (input.file) {
      const stored = await this.media.store(input.gymId, row.id, input.file);
      row = await this.log.attachMedia(row.id, stored.path);
    }

    try {
      await this.queue.enqueue({ messageId: row.id, gymId: input.gymId });
    } catch (err) {
      await this.log.markFailed(row.id, `Could not queue: ${(err as Error).message}`);
      await this.media.remove(row.mediaPath);
      throw new AppError("SERVICE_UNAVAILABLE", "The message queue is not available. Try again in a moment.");
    }
    return { message: toMessageView({ ...row, status: "QUEUED" }), duplicate: false };
  }

  async cancel(gymId: string, messageId: string): Promise<MessageView> {
    const m = await this.log.cancel(gymId, messageId);
    await this.queue.remove(messageId).catch(() => undefined);
    await this.media.remove(m.mediaPath);
    return toMessageView(m);
  }
}
