import { BRANCH_PRICE, INCLUDED_BRANCHES } from "./saas";
import { rupeesLabel } from "./pricing";

// Settings › Help & support: contacts, FAQ, ticket wording and system details (pure; tested).

export const SUPPORT = { email: "support@fitron.in", hours: "Mon–Sat, 9:00 am – 8:00 pm", site: "https://fitron.in/#top" } as const;

export const TOPICS = ["Question", "Something isn't working", "Billing & plan", "WhatsApp", "Biometric device", "Feature request"] as const;
export const PRIORITIES = ["Normal", "Urgent"] as const;

export const FAQ: { q: string; a: string }[] = [
  { q: "How do I add a new member?", a: "Press Add member on the dashboard. Fill the details, pick a plan, upload the form, collect payment. The member ID, invoice and welcome WhatsApp are created automatically." },
  { q: "A member paid only part of the fee. What do I do?", a: "Enter the amount actually received in Collect payment. The balance stays on the invoice and shows in Receivables until it is cleared." },
  { q: "How do I cancel a wrong invoice or payment?", a: "Open it and choose Cancel or Reverse, with a reason. Financial records are never deleted; the correction is kept in the audit log." },
  { q: "Why didn't a WhatsApp reminder go out?", a: "Check Settings › WhatsApp: the number must be linked and the template switched on. Members already reminded within the repeat window, or with an invalid number, are skipped." },
  { q: "How do I renew a membership?", a: "Open the member and press Renew. Pick the plan; the new period starts the day after the current one ends. Collect payment and the invoice is sent on WhatsApp." },
  { q: "Can I edit last month's figures?", a: "Only if the month is not locked. Locked months need a Super Admin to unlock them in Accounting › Month-end closing." },
  {
    q: "How do I add another branch?",
    a: `Settings › Branches › Add branch. Multi-branch plans include ${INCLUDED_BRANCHES} branches; each extra branch is ${rupeesLabel(BRANCH_PRICE.MONTHLY)}/month or ${rupeesLabel(BRANCH_PRICE.YEARLY)}/year including GST, paid from Settings › Plan & billing.`,
  },
  { q: "Is my data backed up?", a: "Yes. Download a full backup any time from Settings › Backup, and restore it from the same page." },
];

export type Contact = { key: "email" | "whatsapp" | "phone" | "site"; label: string; value: string; href: string; external: boolean };

export function supportContacts(o: { gymName: string; whatsapp?: string | null; phone?: string | null }): Contact[] {
  const out: Contact[] = [{ key: "email", label: "Email", value: SUPPORT.email, href: `mailto:${SUPPORT.email}?subject=${encodeURIComponent(`Fitron support · ${o.gymName}`)}`, external: false }];
  if (o.whatsapp) out.push({ key: "whatsapp", label: "WhatsApp", value: `+91 ${o.whatsapp}`, href: `https://wa.me/91${o.whatsapp}?text=${encodeURIComponent(`Hi Fitron support, I need help with ${o.gymName}.`)}`, external: true });
  if (o.phone) out.push({ key: "phone", label: "Call", value: `+91 ${o.phone}`, href: `tel:+91${o.phone}`, external: false });
  out.push({ key: "site", label: "Website", value: SUPPORT.site.replace(/^https?:\/\//, "").replace(/[/#?].*$/, ""), href: SUPPORT.site, external: true });
  return out;
}

/** The prototype's A.device rule, from a user-agent string. */
export function deviceLabel(ua: string | null | undefined): string {
  const s = ua ?? "";
  if (/iPhone|iPad/.test(s)) return "Safari · iOS";
  if (/Android/.test(s)) return "Chrome · Android";
  if (/Edg/.test(s)) return "Edge · Windows";
  if (/Chrome/.test(s)) return "Chrome · Desktop";
  if (/Firefox/.test(s)) return "Firefox · Desktop";
  return "Browser";
}

export function appVersion(): string {
  const v = process.env.APP_VERSION || "dev";
  const c = process.env.APP_COMMIT;
  return c ? `${v} (${c})` : v;
}

/** `prioritySupport`: the gym's plan includes it (Enterprise, Enterprise Partner; hasPrioritySupport in features.ts). */
export const ackText = (number: string, priority: string, prioritySupport = false) => {
  const first = [priority === "Urgent" ? "urgent tickets" : null, prioritySupport ? "tickets on priority-support plans" : null].filter(Boolean);
  return `Thanks, we've got your request ${number}. We reply within 4 working hours${first.length ? `; ${first.join(" and ")} are picked up first.` : "."}`;
};

export function ticketEmail(t: {
  number: string;
  priority: string;
  subject: string;
  gymName: string;
  orgId: string;
  /** The gym's FITRON plan; `prioritySupport` marks the ticket so the team sees it first. */
  plan?: { name: string; prioritySupport: boolean };
  by: { name: string; email: string; role: string };
  branch: string | null;
  topic: string;
  appVersion: string;
  browser: string;
  ip: string | null;
  message: string;
}) {
  return {
    subject: `[${t.number}]${t.plan?.prioritySupport ? " [PRIORITY PLAN]" : ""}${t.priority === "Urgent" ? " [Urgent]" : ""} ${t.subject} — ${t.gymName}`,
    text: [
      `Gym: ${t.gymName} (org ${t.orgId})`,
      ...(t.plan ? [`Plan: ${t.plan.name}${t.plan.prioritySupport ? " (priority support: answer first)" : ""}`] : []),
      `Raised by: ${t.by.name} <${t.by.email}> · ${t.by.role}`,
      `Branch: ${t.branch ?? "All branches"}`,
      `Topic: ${t.topic}`,
      `Priority: ${t.priority}`,
      `App version: ${t.appVersion}`,
      `Browser: ${t.browser}`,
      `IP: ${t.ip ?? "—"}`,
      "",
      t.message,
      "",
      `Reference: ${t.number}`,
    ].join("\n"),
  };
}

export const systemDetailsText = (rows: { k: string; v: string }[], stamp: string) => [...rows.map((r) => `${r.k} ${r.v}`), `Date ${stamp}`].join("\n");
