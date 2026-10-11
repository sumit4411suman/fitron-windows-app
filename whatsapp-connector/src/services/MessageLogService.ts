import type { Message, MessageCategory, MessageStatus, MessageType, Prisma, PrismaClient } from "../generated/prisma/index.js";
import { AppError } from "../utils/errors.js";

export type MessageView = {
  messageId: string;
  recipient: string;
  message: string;
  messageType: MessageType;
  category: MessageCategory;
  status: MessageStatus;
  memberId: string | null;
  templateKey: string | null;
  idempotencyKey: string | null;
  mediaName: string | null;
  providerMessageId: string | null;
  error: string | null;
  attempts: number;
  queuedAt: Date;
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
};

export const toMessageView = (m: Message): MessageView => ({
  messageId: m.id,
  recipient: m.recipient,
  message: m.message,
  messageType: m.messageType,
  category: m.category,
  status: m.status,
  memberId: m.memberId,
  templateKey: m.templateKey,
  idempotencyKey: m.idempotencyKey,
  mediaName: m.mediaName,
  providerMessageId: m.providerMessageId,
  error: m.error,
  attempts: m.attempts,
  queuedAt: m.queuedAt,
  sentAt: m.sentAt,
  deliveredAt: m.deliveredAt,
  readAt: m.readAt,
  failedAt: m.failedAt,
  createdAt: m.createdAt,
});

export type ListFilter = { status?: MessageStatus; messageType?: MessageType; recipient?: string; memberId?: string; from?: Date; to?: Date; ids?: string[]; idempotencyKeys?: string[]; limit?: number; cursor?: string };

/** Delivery states only move forward. */
const RANK: Record<MessageStatus, number> = { QUEUED: 0, PROCESSING: 1, SENT: 2, DELIVERED: 3, READ: 4, FAILED: 5, CANCELLED: 5 };

/** Every message, from the moment it is accepted to its final state. Always scoped by gymId. */
export class MessageLogService {
  constructor(private readonly db: PrismaClient) {}

  async create(data: Omit<Prisma.MessageUncheckedCreateInput, "id" | "status">): Promise<Message> {
    return this.db.message.create({ data: { ...data, status: "QUEUED" } });
  }

  async findByIdempotencyKey(gymId: string, idempotencyKey: string): Promise<Message | null> {
    return this.db.message.findUnique({ where: { gymId_idempotencyKey: { gymId, idempotencyKey } } });
  }

  async get(gymId: string, messageId: string): Promise<Message> {
    const m = await this.db.message.findFirst({ where: { id: messageId, gymId } });
    if (!m) throw new AppError("MESSAGE_NOT_FOUND", "Message not found.");
    return m;
  }

  /** Used by the worker, which already knows the gym from the job. */
  async getForJob(gymId: string, messageId: string): Promise<Message | null> {
    return this.db.message.findFirst({ where: { id: messageId, gymId } });
  }

  async list(gymId: string, f: ListFilter): Promise<{ items: MessageView[]; nextCursor: string | null }> {
    const take = Math.min(Math.max(f.limit ?? 50, 1), 200);
    const where: Prisma.MessageWhereInput = {
      gymId,
      ...(f.status ? { status: f.status } : {}),
      ...(f.messageType ? { messageType: f.messageType } : {}),
      ...(f.recipient ? { recipient: f.recipient } : {}),
      ...(f.memberId ? { memberId: f.memberId } : {}),
      ...(f.ids?.length ? { id: { in: f.ids } } : {}),
      ...(f.idempotencyKeys?.length ? { idempotencyKey: { in: f.idempotencyKeys } } : {}),
      ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
    };
    const rows = await this.db.message.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: take + 1, ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}) });
    const items = rows.slice(0, take).map(toMessageView);
    return { items, nextCursor: rows.length > take ? (items[items.length - 1]?.messageId ?? null) : null };
  }

  async attachMedia(messageId: string, mediaPath: string): Promise<Message> {
    return this.db.message.update({ where: { id: messageId }, data: { mediaPath } });
  }

  async markProcessing(messageId: string): Promise<void> {
    await this.db.message.update({ where: { id: messageId }, data: { status: "PROCESSING", processingAt: new Date(), attempts: { increment: 1 } } });
  }

  /** Back to QUEUED after a transient problem (WhatsApp offline, rate limit wait). */
  async markRequeued(messageId: string, note?: string): Promise<void> {
    await this.db.message.update({ where: { id: messageId }, data: { status: "QUEUED", error: note ?? null } });
  }

  async markSent(messageId: string, providerMessageId: string | null): Promise<void> {
    await this.db.message.update({ where: { id: messageId }, data: { status: "SENT", sentAt: new Date(), providerMessageId, error: null, mediaPath: null } });
  }

  async markFailed(messageId: string, error: string): Promise<void> {
    await this.db.message.update({ where: { id: messageId }, data: { status: "FAILED", failedAt: new Date(), error: error.slice(0, 1000), mediaPath: null } });
  }

  async cancel(gymId: string, messageId: string): Promise<Message> {
    const m = await this.get(gymId, messageId);
    if (m.status !== "QUEUED") throw new AppError("CONFLICT", `Only queued messages can be cancelled (this one is ${m.status}).`);
    return this.db.message.update({ where: { id: messageId }, data: { status: "CANCELLED", mediaPath: null } });
  }

  /** Delivery receipt from WhatsApp, found by the provider's message id. Ignored when it would move the status backwards. */
  async applyReceipt(gymId: string, providerMessageId: string, status: "DELIVERED" | "READ" | "FAILED", error?: string): Promise<void> {
    const m = await this.db.message.findFirst({ where: { gymId, providerMessageId } });
    if (!m || RANK[status] <= RANK[m.status]) return;
    const now = new Date();
    await this.db.message.update({ where: { id: m.id }, data: { status, ...(status === "DELIVERED" ? { deliveredAt: now } : status === "READ" ? { readAt: now, deliveredAt: m.deliveredAt ?? now } : { failedAt: now, error: error ?? "WhatsApp could not deliver this message." }) } });
  }

  async stats(gymId: string, since: Date): Promise<{ sentToday: number; failedToday: number; queued: number }> {
    const [sent, failed, queued] = await Promise.all([
      this.db.message.count({ where: { gymId, status: { in: ["SENT", "DELIVERED", "READ"] }, sentAt: { gte: since } } }),
      this.db.message.count({ where: { gymId, status: "FAILED", failedAt: { gte: since } } }),
      this.db.message.count({ where: { gymId, status: { in: ["QUEUED", "PROCESSING"] } } }),
    ]);
    return { sentToday: sent, failedToday: failed, queued };
  }

  /** Messages that were still queued or processing when a worker died: put back to QUEUED so the queue picks them up. */
  async findStuck(olderThan: Date): Promise<Message[]> {
    return this.db.message.findMany({ where: { status: "PROCESSING", processingAt: { lt: olderThan } } });
  }
}
