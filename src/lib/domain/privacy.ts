// Settings › Privacy & DPDP: the gym's privacy notice, the cookie notice, the grievance officer
// and what an erasure strips from a member. Pure; the service in src/lib/services/privacy.ts
// reads and writes the `privacy` Setting row.

import { addMonths, type IsoDate } from "./dates";

export const NOTICE_KEYS = ["who", "collect", "why", "consent", "rights", "children", "retention", "security", "sharing"] as const;
export type NoticeKey = (typeof NOTICE_KEYS)[number];

export const NOTICE_TITLES: Record<NoticeKey, string> = {
  who: "Who we are",
  collect: "What we collect",
  why: "Why we use it",
  consent: "Your consent",
  rights: "Your rights",
  children: "Children",
  retention: "How long we keep it",
  security: "Security and breaches",
  sharing: "Sharing",
};

/** The prototype's notice paragraphs. `{{gymName}}` is substituted when rendered and kept literally in storage. */
export const DEFAULT_NOTICE: Record<NoticeKey, string> = {
  who: "{{gymName}} is the Data Fiduciary for member data. Fitron Gym Accounting Solution processes that data on the gym's behalf as a Data Processor.",
  collect:
    "Name, phone, WhatsApp number, email, date of birth, gender, address, emergency contact, photo, ID and address proof, health notes you choose to share, membership and payment records, attendance, and face or fingerprint templates if you use biometric entry.",
  why: "To register and identify you, run your membership, take payments and issue GST invoices, send reminders and receipts on WhatsApp, control door access, and keep you safe in the gym. We don't sell your data or use it for unrelated purposes.",
  consent:
    "We process your data with your consent, given at registration, or where the law allows it without consent (for example, keeping tax records). You can withdraw consent at any time; this stops future processing but may mean we can't continue your membership.",
  rights:
    "You can ask for a summary of your data, ask us to correct or complete it, ask us to erase it once it is no longer needed, nominate someone to act for you, and raise a grievance. Contact the Grievance Officer below. If you are not satisfied, you can complain to the Data Protection Board of India.",
  children: "For members under 18 we need verifiable consent from a parent or guardian, and we don't track or target children with advertising.",
  retention:
    "While your membership is active, then for the period set by the gym, after which personal details are erased. Invoices and payment records are kept as required by tax law, linked only to your member ID.",
  security:
    "Data is stored encrypted with role-based access; staff only see what their role needs. If a breach happens we will inform you and the Data Protection Board as the law requires.",
  sharing: "Only with service providers who help run the gym (payment gateway, WhatsApp provider, cloud hosting, biometric device vendor), under contracts that protect your data.",
};

export const DEFAULT_COOKIE_NOTICE =
  "Fitron uses essential browser storage to keep you signed in, remember your branch and theme, and save your work. These are needed for the app to work. Optional analytics storage is used only if you allow it in the banner, and you can change that choice at any time.";

export const DEFAULT_RETAIN_MONTHS = 24;

export type PrivacySettings = {
  officer?: string;
  email?: string;
  phone?: string;
  /** Months personal data is kept after the last membership ends; 0 = until erased by hand. */
  retainMonths?: number;
  /** Only the sections the gym edited; the rest render from DEFAULT_NOTICE. */
  notice?: Partial<Record<NoticeKey, string>>;
  cookieNotice?: string;
  /** ISO date of the last notice / cookie text save. */
  noticeUpdatedAt?: string;
};

export const DEFAULT_PRIVACY = { retainMonths: DEFAULT_RETAIN_MONTHS, notice: {} as Partial<Record<NoticeKey, string>>, cookieNotice: DEFAULT_COOKIE_NOTICE };

/** The saved text of one section (or the template), with the gym's name filled in. */
export function noticeText(s: PrivacySettings, key: NoticeKey, gymName: string) {
  const raw = s.notice?.[key]?.trim() || DEFAULT_NOTICE[key];
  return raw.replaceAll("{{gymName}}", gymName);
}

/** All nine sections in order, ready to show. */
export const renderNotice = (s: PrivacySettings, gymName: string) => NOTICE_KEYS.map((key) => ({ key, title: NOTICE_TITLES[key], text: noticeText(s, key, gymName) }));

/**
 * Keeps only the sections whose text differs from the template (so template updates flow through).
 * The gym's name is stored as `{{gymName}}`, as the template has it, so a rename shows everywhere.
 */
export function editedSections(posted: Partial<Record<NoticeKey, string>>, gymName = ""): Partial<Record<NoticeKey, string>> {
  const out: Partial<Record<NoticeKey, string>> = {};
  for (const k of NOTICE_KEYS) {
    const t = (posted[k]?.trim() ?? "").replaceAll("{{gymName}}", gymName);
    if (!t || t === DEFAULT_NOTICE[k].replaceAll("{{gymName}}", gymName)) continue;
    out[k] = gymName ? t.replaceAll(gymName, "{{gymName}}") : t;
  }
  return out;
}

/** Members whose last membership ended before this date are past their retention period; null = retention off. */
export function retentionCutoff(today: IsoDate, months: number): IsoDate | null {
  if (!Number.isFinite(months) || months <= 0) return null;
  return addMonths(today, -Math.floor(months));
}

/** Every personal column on Member, as it is written by an erasure. Code, gender, branch, source and createdAt stay. */
export function anonymisedMember(now: Date, deletedAt: Date | null) {
  return {
    name: "Erased member",
    phone: "",
    whatsapp: null,
    email: null,
    dob: null,
    occupation: null,
    house: null,
    area: null,
    city: null,
    state: null,
    pin: null,
    emergencyName: null,
    emergencyRelation: null,
    emergencyPhone: null,
    notes: null,
    staffNotes: null,
    tags: [] as string[],
    photoKey: null,
    oldId: null,
    riskScore: null,
    riskReasons: [] as string[],
    trainerId: null,
    deletedAt: deletedAt ?? now,
    erasedAt: now,
  };
}

/** Names of the personal fields that held a value, for the audit row (never the values themselves). */
export function filledPersonalFields(m: Record<string, unknown>) {
  return Object.keys(anonymisedMember(new Date(), null))
    .filter((k) => !["deletedAt", "erasedAt"].includes(k))
    .filter((k) => {
      const v = m[k];
      return Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && v !== "";
    });
}
