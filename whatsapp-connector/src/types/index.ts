import type { MessageCategory, MessageStatus, MessageType, SessionStatus } from "../generated/prisma/index.js";

export type { MessageCategory, MessageStatus, MessageType, SessionStatus };

/** Who is calling: a gym (by its API key) or an administrator (by the master key). */
export type Principal = { kind: "gym"; gymId: string; gymName: string } | { kind: "master" };

declare module "express-serve-static-core" {
  interface Request {
    principal?: Principal;
    requestId: string;
  }
}

/** Events published by the worker for one gym, delivered to the events stream. */
export type SessionEvent =
  | { type: "qr"; data: string; expiresAt: string }
  | { type: "status"; data: { status: SessionStatus; phone?: string | null; error?: string | null } }
  | { type: "message"; data: { messageId: string; status: MessageStatus; error?: string | null } }
  | { type: "heartbeat"; data: { at: string } };

/** Commands sent from the API to whichever process owns the WhatsApp sessions. */
export type SessionCommand = { action: "connect" | "disconnect" | "logout" | "refresh"; gymId: string; at: string };

export type SessionSnapshot = { status: SessionStatus; phone: string | null; connectedAt: Date | null; lastSeenAt: Date | null; lastError: string | null };

/** The payload one queue job carries. Everything else is read from the database by message id. */
export type SendJob = { messageId: string; gymId: string };

export const QUEUE_NAME = "wa-send";

export const REDIS_KEYS = {
  control: "wa:control",
  events: (gymId: string) => `wa:events:${gymId}`,
  qr: (gymId: string) => `wa:qr:${gymId}`,
  watch: (gymId: string) => `wa:watch:${gymId}`,
  workerLock: "wa:worker:lock",
  workerHeartbeat: "wa:worker:heartbeat",
  lastSent: (gymId: string) => `wa:lastsent:${gymId}`,
  rate: (gymId: string, window: string, bucket: number) => `wa:rate:${gymId}:${window}:${bucket}`,
  queued: (gymId: string) => `wa:queued:${gymId}`,
} as const;
