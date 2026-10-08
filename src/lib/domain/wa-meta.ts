// Fitron's WhatsApp templates as Meta wants them for the official WhatsApp Business API. Meta only lets a business start a
// conversation with an approved template, so each gym's templates are submitted to its own WhatsApp Business account when
// it connects. Pure functions: nothing here talks to Meta.
import { placeholders, type TemplateVars } from "./whatsapp";

/** A custom message is free text, which Meta does not allow outside a 24-hour customer window, so it is never a template. */
export const NO_META_TEMPLATE = ["campaign"];

/** Templates that go with an invoice PDF: Meta needs a document header on them. */
export const DOC_HEADER_KEYS = ["invoice", "renewal"];

/** Meta puts reminders, receipts and confirmations in Utility. Offers and greetings are Marketing (it recategorises on its own when it disagrees). */
const MARKETING = ["winback", "birthday"];

/** Sample values Meta asks for with each variable, so its reviewers see what a message looks like. */
export const VAR_EXAMPLES: Required<TemplateVars> = {
  member_name: "Rahul",
  member_id: "M-0042",
  plan_name: "Quarterly Gold",
  start_date: "1 Oct 2026",
  expiry_date: "31 Dec 2026",
  amount: "4,720",
  pending_amount: "1,200",
  invoice_number: "INV-1042",
  gym_name: "Power Haus Gym",
  link: "https://fitron.in/pay/abc123",
  class_name: "Morning HIIT",
  class_time: "Sat 7:00 am",
  grievance_officer: "Asha Rao",
  grievance_email: "help@gym.example",
  grievance_phone: "9876543210",
};

export const metaTemplateName = (key: string) => `fitron_${key}`;

export type MetaTemplate = {
  key: string;
  name: string;
  language: string;
  category: "UTILITY" | "MARKETING";
  /** The body with {{1}}, {{2}}… for the variables, in the order placeholders() lists them. */
  text: string;
  vars: string[];
  examples: string[];
  docHeader: boolean;
};

/** One Fitron template in Meta's format, or null for one that cannot be a template. */
export function toMetaTemplate(key: string, body: string, language = "en"): MetaTemplate | null {
  if (NO_META_TEMPLATE.includes(key)) return null;
  const vars = placeholders(body);
  let text = body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => `{{${vars.indexOf(k) + 1}}}`).trim();
  // Meta rejects a body that starts or ends with a variable.
  if (/\}\}$/.test(text)) text += ".";
  if (/^\{\{/.test(text)) text = `Hi, ${text}`;
  return {
    key,
    name: metaTemplateName(key),
    language,
    category: MARKETING.includes(key) ? "MARKETING" : "UTILITY",
    text,
    vars,
    examples: vars.map((v) => VAR_EXAMPLES[v as keyof typeof VAR_EXAMPLES] ?? "sample"),
    docHeader: DOC_HEADER_KEYS.includes(key),
  };
}


/** The "Send test" message in cloud mode: a template too, since a business may not start a conversation with free text. */
export const TEST_META_TEMPLATE: MetaTemplate = { key: "test", name: metaTemplateName("test"), language: "en", category: "UTILITY", text: "This is a Fitron test message. Your WhatsApp is connected and sending.", vars: [], examples: [], docHeader: false };
