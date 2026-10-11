import type { Consent, MessageCategory, PrismaClient } from "../generated/prisma/index.js";
import { AppError } from "../utils/errors.js";

export type ConsentPolicy = { allowTransactionalAfterOptOut: boolean; requireOptInForTransactional: boolean };

export type ConsentView = { memberId: string | null; phoneNumber: string; whatsappOptIn: boolean; optInSource: string | null; optInAt: Date | null; optOutSource: string | null; optOutAt: Date | null; updatedAt: Date };

const view = (c: Consent): ConsentView => ({ memberId: c.memberId, phoneNumber: c.phoneNumber, whatsappOptIn: c.whatsappOptIn, optInSource: c.optInSource, optInAt: c.optInAt, optOutSource: c.optOutSource, optOutAt: c.optOutAt, updatedAt: c.updatedAt });

/**
 * Who may be messaged. Marketing (non-essential) messages need an explicit opt-in. Transactional messages go to anyone
 * who has not opted out; after an opt-out everything stops unless the operator has explicitly allowed transactional
 * messages (ALLOW_TRANSACTIONAL_AFTER_OPT_OUT) because their contracts and local law permit it.
 */
export class ConsentService {
  constructor(
    private readonly db: PrismaClient,
    private readonly policy: ConsentPolicy,
  ) {}

  async get(gymId: string, phoneNumber: string): Promise<ConsentView | null> {
    const c = await this.db.consent.findUnique({ where: { gymId_phoneNumber: { gymId, phoneNumber } } });
    return c ? view(c) : null;
  }

  async list(gymId: string, opts: { memberId?: string; optedIn?: boolean; limit?: number } = {}): Promise<ConsentView[]> {
    const rows = await this.db.consent.findMany({ where: { gymId, ...(opts.memberId ? { memberId: opts.memberId } : {}), ...(opts.optedIn !== undefined ? { whatsappOptIn: opts.optedIn } : {}) }, orderBy: { updatedAt: "desc" }, take: Math.min(opts.limit ?? 100, 500) });
    return rows.map(view);
  }

  async optIn(gymId: string, phoneNumber: string, source: string, memberId?: string): Promise<ConsentView> {
    const now = new Date();
    const c = await this.db.consent.upsert({
      where: { gymId_phoneNumber: { gymId, phoneNumber } },
      create: { gymId, phoneNumber, memberId: memberId ?? null, whatsappOptIn: true, optInSource: source, optInAt: now },
      update: { whatsappOptIn: true, optInSource: source, optInAt: now, optOutAt: null, optOutSource: null, ...(memberId ? { memberId } : {}) },
    });
    return view(c);
  }

  async optOut(gymId: string, phoneNumber: string, source: string, memberId?: string): Promise<ConsentView> {
    const now = new Date();
    const c = await this.db.consent.upsert({
      where: { gymId_phoneNumber: { gymId, phoneNumber } },
      create: { gymId, phoneNumber, memberId: memberId ?? null, whatsappOptIn: false, optOutSource: source, optOutAt: now },
      update: { whatsappOptIn: false, optOutSource: source, optOutAt: now, ...(memberId ? { memberId } : {}) },
    });
    return view(c);
  }

  /** Throws CONSENT_REQUIRED or OPTED_OUT when the message must not be sent. */
  async assertAllowed(gymId: string, phoneNumber: string, category: MessageCategory): Promise<void> {
    const c = await this.get(gymId, phoneNumber);
    const optedOut = !!c && !c.whatsappOptIn && !!c.optOutAt;
    if (category === "MARKETING") {
      if (!c || !c.whatsappOptIn) throw new AppError(optedOut ? "OPTED_OUT" : "CONSENT_REQUIRED", optedOut ? "This member has opted out of WhatsApp messages." : "This member has not opted in to WhatsApp messages.");
      return;
    }
    if (optedOut && !this.policy.allowTransactionalAfterOptOut) throw new AppError("OPTED_OUT", "This member has opted out of WhatsApp messages.");
    if (this.policy.requireOptInForTransactional && !(c && c.whatsappOptIn)) throw new AppError("CONSENT_REQUIRED", "This member has not opted in to WhatsApp messages.");
  }
}

/** Does an incoming message mean "stop"? Matched on the whole trimmed text, case-insensitive, punctuation ignored. */
export function matchesKeyword(text: string, keywords: string[]): boolean {
  const t = text.trim().toUpperCase().replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ");
  return t.length > 0 && t.length <= 40 && keywords.some((k) => k === t);
}
