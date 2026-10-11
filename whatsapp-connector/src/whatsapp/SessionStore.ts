import type { PrismaClient, SessionStatus, WhatsAppSession } from "../generated/prisma/index.js";
import type { SessionSnapshot } from "../types/index.js";

const ACTIVE: SessionStatus[] = ["CONNECTED", "CONNECTING", "RECONNECTING", "QR_REQUIRED"];

/** The WhatsAppSession row: the one place both processes read connection state from. */
export class SessionStore {
  constructor(private readonly db: PrismaClient) {}

  async get(gymId: string): Promise<SessionSnapshot> {
    const s = await this.db.whatsAppSession.findUnique({ where: { gymId } });
    return s ? snap(s) : { status: "DISCONNECTED", phone: null, connectedAt: null, lastSeenAt: null, lastError: null };
  }

  async setStatus(gymId: string, status: SessionStatus, patch: { phoneNumber?: string | null; lastError?: string | null; sessionLocation?: string | null; connectedAt?: Date | null } = {}): Promise<SessionSnapshot> {
    const now = new Date();
    const data = { status, lastSeenAt: now, ...patch, ...(status === "CONNECTED" && patch.connectedAt === undefined ? { connectedAt: now } : {}) };
    const s = await this.db.whatsAppSession.upsert({ where: { gymId }, create: { gymId, ...data }, update: data });
    return snap(s);
  }

  async touch(gymId: string): Promise<void> {
    await this.db.whatsAppSession.updateMany({ where: { gymId }, data: { lastSeenAt: new Date() } });
  }

  /** Sessions the worker should bring back after a restart. */
  async listRestorable(): Promise<{ gymId: string; status: SessionStatus; sessionLocation: string | null; updatedAt: Date }[]> {
    const rows = await this.db.whatsAppSession.findMany({ where: { status: { in: ACTIVE }, gym: { status: "ACTIVE" } }, select: { gymId: true, status: true, sessionLocation: true, updatedAt: true } });
    return rows;
  }
}

const snap = (s: WhatsAppSession): SessionSnapshot => ({ status: s.status, phone: s.phoneNumber, connectedAt: s.connectedAt, lastSeenAt: s.lastSeenAt, lastError: s.lastError });
