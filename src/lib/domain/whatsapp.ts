// WhatsApp templates from the prototype, and how they're filled in.

import { defaultRule, toColumns } from "./wa-rules";

export const VARS = ["member_name", "member_id", "plan_name", "start_date", "expiry_date", "amount", "pending_amount", "invoice_number", "gym_name", "link", "class_name", "class_time", "grievance_officer", "grievance_email", "grievance_phone"] as const;
export type TemplateVars = Partial<Record<(typeof VARS)[number], string>>;

/** Reminder templates are skipped if the same one went to the member inside the de-dup window (rule 5). */
export const REMINDER_KEYS = ["due", "exp15", "exp7", "exp3", "exp1", "expired", "birthday", "autopay", "winback"];

export const DEFAULT_TEMPLATES: { key: string; name: string; trigger: string; autoSend: boolean; body: string }[] = [
  { key: "welcome", name: "Welcome message", trigger: "New membership sold", autoSend: true, body: "Hi {{member_name}}, welcome to {{gym_name}}!\n\nYour member ID is {{member_id}}.\nPlan: {{plan_name}}\nValid: {{start_date}} to {{expiry_date}}\n\nSee you on the floor." },
  { key: "payment", name: "Payment confirmation", trigger: "Payment received", autoSend: true, body: "Hi {{member_name}}, we have received ₹{{amount}} against invoice {{invoice_number}}. Balance due: ₹{{pending_amount}}.\n\nThank you,\n{{gym_name}}" },
  { key: "invoice", name: "Invoice PDF", trigger: "Invoice created (PDF attached)", autoSend: false, body: "Hi {{member_name}}, your invoice {{invoice_number}} for ₹{{amount}} is attached as a PDF.\n\n{{gym_name}}" },
  { key: "due", name: "Payment reminder", trigger: "Balance pending (daily job)", autoSend: true, body: "Hi {{member_name}}, a balance of ₹{{pending_amount}} is pending on invoice {{invoice_number}}. Please pay at the front desk or by UPI.\n\n{{gym_name}}" },
  { key: "exp15", name: "Expiry reminder · 15 days", trigger: "15 days before expiry", autoSend: false, body: "Hi {{member_name}}, your {{gym_name}} membership ends on {{expiry_date}}, 15 days from now.\n\nPlan: {{plan_name}}\nRenewal amount: ₹{{amount}}\n\nRenew any time at the front desk or reply to this message." },
  { key: "exp7", name: "Expiry reminder · 7 days", trigger: "7 days before expiry", autoSend: true, body: "Hi {{member_name}},\n\nYour {{gym_name}} membership is expiring on {{expiry_date}}.\n\nMembership plan: {{plan_name}}\nRenewal amount: ₹{{amount}}\n\nPlease contact us or visit the gym to renew." },
  { key: "exp3", name: "Expiry reminder · 3 days", trigger: "3 days before expiry", autoSend: true, body: "Hi {{member_name}}, your gym membership will expire in 3 days ({{expiry_date}}). Renewal amount: ₹{{amount}}.\n\n{{gym_name}}" },
  { key: "exp1", name: "Expiry reminder · 1 day", trigger: "1 day before expiry", autoSend: true, body: "Hi {{member_name}}, your membership expires tomorrow. Renew {{plan_name}} for ₹{{amount}} at the front desk or reply to this message.\n\n{{gym_name}}" },
  { key: "expired", name: "Expiry message", trigger: "On expiry date", autoSend: true, body: "Hi {{member_name}}, your {{gym_name}} membership has expired. Renew now to continue your fitness journey.\n\n{{gym_name}}" },
  { key: "renewal", name: "Renewal confirmation", trigger: "Membership renewed", autoSend: true, body: "Hi {{member_name}}, your {{plan_name}} membership is renewed till {{expiry_date}}. Invoice {{invoice_number}} is attached.\n\n{{gym_name}}" },
  { key: "mandate", name: "Autopay approval link", trigger: "Autopay set up", autoSend: true, body: "Hi {{member_name}}, approve UPI autopay for your {{plan_name}} membership (₹{{amount}} each renewal) in any UPI app: {{link}}\n\n{{gym_name}}" },
  { key: "autopay", name: "Autopay debit notice", trigger: "24 h before autopay debit", autoSend: true, body: "Hi {{member_name}}, ₹{{amount}} will be debited tomorrow via UPI autopay for your {{plan_name}} membership.\n\n{{gym_name}}" },
  { key: "class", name: "Class booking confirmation", trigger: "Class booked", autoSend: false, body: "Hi {{member_name}}, you're booked for {{class_name}} on {{class_time}}. Please arrive 5 minutes early.\n\n{{gym_name}}" },
  { key: "winback", name: "Win-back offer", trigger: "Fitron AI · member at risk", autoSend: false, body: "Hi {{member_name}}, we have missed you at {{gym_name}}! Come back this week and your next session with a trainer is on us." },
  { key: "birthday", name: "Birthday wishes", trigger: "On birthday (daily job)", autoSend: true, body: "Happy birthday, {{member_name}}! Everyone at {{gym_name}} wishes you a strong year ahead." },
  { key: "campaign", name: "Custom message", trigger: "Sent by staff", autoSend: false, body: "Hi {{member_name}}, " },
];

/** The default templates with their automation rule columns, as listTemplates creates them. */
export const defaultTemplateRows = () => DEFAULT_TEMPLATES.map((t) => ({ ...t, ...toColumns(defaultRule(t.key)) }));

/** Variables in the order they first appear, for Cloud API template parameters ({{1}}, {{2}}…). */
export const placeholders = (body: string) => [...new Set([...body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]!))];

export const render = (body: string, vars: TemplateVars) => body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => vars[k as keyof TemplateVars] ?? "");

/** Indian mobile → WhatsApp id "91XXXXXXXXXX", or null if it isn't one. */
export function waNumber(phone: string | null | undefined) {
  const d = (phone ?? "").replace(/\D/g, "").replace(/^0+/, "");
  const ten = d.length === 12 && d.startsWith("91") ? d.slice(2) : d;
  return /^[6-9]\d{9}$/.test(ten) ? `91${ten}` : null;
}

/** Rupees for message text: 4720 paise×100 → "4,720" or "4,720.50". */
export const rupeesText = (paise: number) => (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 });

/** One line of the automation run log: "3 Oct, 7:02 am · All scheduled rules · 4 sent, 1 skipped" (older records had no name or skipped). */
export function runLine(r: { ts: string; name?: string; sent: number; skipped?: number; held?: number }, fts: (ts: string) => string) {
  const extra = `${r.skipped ? `, ${r.skipped} skipped` : ""}${r.held ? `, ${r.held} held` : ""}`;
  return `${fts(r.ts)} · ${r.name || "All scheduled rules"} · ${r.sent} sent${extra}`;
}
