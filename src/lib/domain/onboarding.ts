/**
 * First-run setup for a gym that signed up on fitron.in: the questions a new owner answers before the console opens
 * (prototype `A.OB`). Pure: the page, the wizard and the actions share these steps and checks, so what the form accepts is
 * exactly what the server accepts.
 */
import type { Feature } from "./features";
import { GSTIN } from "./go-live";

export type StepKey = "tax" | "branch" | "plans" | "staff" | "whatsapp" | "opening" | "start" | "review";

type StepInfo = { label: string; desc: string; title: string; sub: string; feature?: Feature };

export const STEP_INFO: Record<StepKey, StepInfo> = {
  tax: { label: "Billing & GST", desc: "Invoices and tax", title: "Billing & GST", sub: "How invoices are numbered and taxed. Tax rates are never hard-coded." },
  branch: { label: "Branch", desc: "Location and hours", title: "Your branch", sub: "Your main location. You can add more branches later in Settings." },
  plans: { label: "Plans", desc: "What you sell", title: "Membership plans", sub: "The plans you sell. Members are added and renewed on these." },
  staff: { label: "Team", desc: "Who uses Fitron", title: "Your team", sub: "Add the people who will use Fitron. Optional: you can add them later.", feature: "staff" },
  whatsapp: { label: "WhatsApp", desc: "Messages and reminders", title: "WhatsApp & reminders", sub: "Which messages go out automatically. You connect your WhatsApp number later in Settings.", feature: "whatsapp" },
  opening: { label: "Opening balances", desc: "Cash and bank today", title: "Opening balances", sub: "Cash in hand and the bank balance today, so your cash and bank books start right. Optional.", feature: "accounting" },
  start: { label: "Data", desc: "Fresh start or import", title: "Your data", sub: "Start fresh, or bring your existing members across." },
  review: { label: "Review", desc: "Check and finish", title: "Review", sub: "Check everything before you start." },
};

const ORDER: StepKey[] = ["tax", "branch", "plans", "staff", "whatsapp", "opening", "start", "review"];

/** The steps this gym sees: the ones about something its FITRON plan doesn't open are left out. */
export const stepsFor = (has: (f: Feature) => boolean): StepKey[] => ORDER.filter((k) => !STEP_INFO[k].feature || has(STEP_INFO[k].feature!));

export const STAFF_ROLES = ["Admin", "Accountant", "Receptionist", "Trainer"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export const GST_RATES = ["5", "12", "18", "28"] as const;
export const GST_TYPES = ["CGST+SGST", "IGST"] as const;
export const START_MODES = ["empty", "import"] as const;
export type StartMode = (typeof START_MODES)[number];

export type PlanRow = { name: string; months: string; price: string; regFee: string };
export type StaffRow = { name: string; role: StaffRole; phone: string; email: string; password: string };
export type Reminders = { welcome: boolean; d7: boolean; d3: boolean; d1: boolean; d0: boolean; birthday: boolean };

/** Everything the wizard collects. All values are what was typed, so the form can be refilled as it was. */
export type OnboardingForm = {
  tax: { gst: boolean; gstin: string; rate: string; type: (typeof GST_TYPES)[number]; prefix: string; start: string };
  branch: { short: string; hours: string; manager: string };
  rows: PlanRow[];
  staff: StaffRow[];
  wa: Reminders;
  opening: { cash: string; bank: string };
  mode: StartMode;
};

/** What Setting `onboarding` holds. A gym with no such setting was set up by hand and never sees the wizard. */
export type OnboardingState = { status: "PENDING" | "SKIPPED" | "DONE"; step?: StepKey | null; draft?: OnboardingForm | null; at?: string };

export const PLAN_SUGGEST: PlanRow[] = [
  { name: "Monthly", months: "1", price: "1500", regFee: "500" },
  { name: "Quarterly", months: "3", price: "4000", regFee: "500" },
  { name: "Half-Yearly", months: "6", price: "7500", regFee: "0" },
  { name: "Annual", months: "12", price: "13000", regFee: "0" },
];

export const emptyPlan = (): PlanRow => ({ name: "", months: "1", price: "", regFee: "0" });
export const emptyStaff = (): StaffRow => ({ name: "", role: "Receptionist", phone: "", email: "", password: "" });

export function defaultForm(): OnboardingForm {
  return {
    tax: { gst: false, gstin: "", rate: "18", type: "CGST+SGST", prefix: "INV-", start: "1001" },
    branch: { short: "Main", hours: "06:00 – 22:00", manager: "" },
    rows: PLAN_SUGGEST.map((r) => ({ ...r })),
    staff: [emptyStaff()],
    wa: { welcome: true, d7: true, d3: true, d1: true, d0: true, birthday: true },
    opening: { cash: "", bank: "" },
    mode: "empty",
  };
}

const filled = (...v: string[]) => v.some((s) => s.trim() !== "");
/** Plan rows the owner actually filled in; an untouched blank row is not an error. */
export const planRows = (f: OnboardingForm) => f.rows.filter((r) => filled(r.name, r.price));
export const staffRows = (f: OnboardingForm) => f.staff.filter((s) => filled(s.name, s.phone, s.email, s.password));

/** A phone typed with spaces, dashes or a +91 in front, as the rest of the app reads it. */
export const normalPhone = (s: string) => s.trim().replace(/[\s-]/g, "").replace(/^(\+91|91|0)(?=\d{10}$)/, "");
const AMOUNT = /^\d+(\.\d{1,2})?$/;
const money = (s: string) => s.replace(/[₹,\s]/g, "");
const EMAIL = /^\S+@\S+\.\S+$/;
const PREFIX = /^[A-Z0-9/-]{1,10}$/;

/** The first thing wrong with one step, in the words the owner reads; null when it is fine. */
export function validateStep(key: StepKey, f: OnboardingForm): string | null {
  switch (key) {
    case "tax": {
      const t = f.tax;
      if (t.gst && !GSTIN.test(t.gstin.trim().toUpperCase())) return "GSTIN should be 15 characters, e.g. 20ABCDE1234F1Z5.";
      const rate = Number(t.rate);
      if (t.gst && (!Number.isFinite(rate) || rate < 0 || rate > 28)) return "GST rate must be between 0 and 28.";
      if (!PREFIX.test(t.prefix.trim().toUpperCase())) return "Invoice prefix: 1–10 letters, numbers, - or /.";
      const start = Number(t.start);
      if (!/^\d+$/.test(t.start.trim()) || start < 1) return "First invoice number must be 1 or more.";
      if (start > 1_000_000_000) return "First invoice number is too large.";
      return null;
    }
    case "branch": {
      const b = f.branch;
      if (!b.short.trim()) return "Give the branch a short name, e.g. Main or City Centre.";
      if (b.short.trim().length > 30) return "Branch name can be up to 30 characters.";
      if (!b.hours.trim()) return "Enter opening hours.";
      if (b.hours.trim().length > 40) return "Opening hours can be up to 40 characters, e.g. 06:00 – 22:00.";
      if (b.manager.trim().length > 80) return "Branch manager's name is too long.";
      return null;
    }
    case "plans": {
      const rows = planRows(f);
      if (!rows.length) return "Add at least one membership plan.";
      for (const r of rows) {
        const name = r.name.trim();
        if (!name) return "Every plan needs a name.";
        if (name.length < 2 || name.length > 80) return `${name}: the name needs 2–80 characters.`;
        const months = Number(r.months);
        if (!/^\d+$/.test(r.months.trim()) || months < 1 || months > 60) return `${name}: duration must be 1 to 60 months.`;
        if (!AMOUNT.test(money(r.price)) || Number(money(r.price)) <= 0) return `${name}: enter a price.`;
        if (r.regFee.trim() !== "" && !AMOUNT.test(money(r.regFee))) return `${name}: registration fee should be an amount in rupees.`;
      }
      const names = rows.map((r) => r.name.trim().toLowerCase());
      if (new Set(names).size !== names.length) return "Two plans have the same name.";
      return null;
    }
    case "staff": {
      const rows = staffRows(f);
      for (const s of rows) {
        const who = s.name.trim() || "A team member";
        if (s.name.trim().length < 2) return "Each team member needs a name.";
        if (!STAFF_ROLES.includes(s.role)) return `${who}: pick a role.`;
        if (!/^[6-9]\d{9}$/.test(normalPhone(s.phone))) return `${who}: enter a 10-digit mobile number.`;
        if (!EMAIL.test(s.email.trim())) return `${who}: enter a valid email to sign in with.`;
        if (s.password.length < 8) return `${who}: set a first password of at least 8 characters.`;
      }
      const emails = rows.map((s) => s.email.trim().toLowerCase());
      if (new Set(emails).size !== emails.length) return "Two team members have the same email.";
      return null;
    }
    case "opening": {
      for (const [label, v] of [["cash", f.opening.cash], ["bank", f.opening.bank]] as const) {
        if (v.trim() !== "" && !AMOUNT.test(money(v))) return `Enter the ${label} balance in rupees, or leave it blank.`;
      }
      return null;
    }
    case "start":
      return START_MODES.includes(f.mode) ? null : "Pick how you want to start.";
    case "whatsapp":
    case "review":
      return null;
  }
}

/** The first failing step among `steps`, so the server can send the owner back to it. */
export function firstInvalid(steps: StepKey[], f: OnboardingForm): { step: StepKey; message: string } | null {
  for (const step of steps) {
    const message = validateStep(step, f);
    if (message) return { step, message };
  }
  return null;
}

/** An amount as the owner typed it, in lakhs style, with paise only when there are some: ₹1,500 and ₹25,000.50. */
export const rupeesLabel = (s: string) => {
  const n = Number(money(s) || 0);
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
};

const REMINDER_LABELS: [keyof Reminders, string][] = [
  ["welcome", "welcome message"],
  ["d7", "7 days before expiry"],
  ["d3", "3 days before"],
  ["d1", "1 day before"],
  ["d0", "on the day it expires"],
  ["birthday", "birthdays"],
];

/** The Review step: what will be set up, one line each, only for the steps this gym sees. */
export function reviewRows(f: OnboardingForm, steps: StepKey[]): { k: string; v: string }[] {
  const rows: { k: string; v: string }[] = [];
  const has = (s: StepKey) => steps.includes(s);
  if (has("tax")) {
    rows.push({ k: "GST", v: f.tax.gst ? `${f.tax.gstin.trim().toUpperCase()} · ${f.tax.rate}% ${f.tax.type}` : "Not registered" });
    rows.push({ k: "Invoices", v: `${f.tax.prefix.trim().toUpperCase()}${f.tax.start.trim()} onwards` });
  }
  if (has("branch")) rows.push({ k: "Branch", v: [f.branch.short.trim(), f.branch.hours.trim(), f.branch.manager.trim() && `run by ${f.branch.manager.trim()}`].filter(Boolean).join(" · ") });
  if (has("plans")) rows.push({ k: "Plans", v: planRows(f).map((r) => `${r.name.trim()} ${rupeesLabel(r.price)}`).join(", ") || "None yet" });
  if (has("staff")) {
    const s = staffRows(f);
    rows.push({ k: "Team", v: s.length ? s.map((x) => `${x.name.trim()} (${x.role})`).join(", ") : "Only you for now" });
  }
  if (has("whatsapp")) {
    const on = REMINDER_LABELS.filter(([k]) => f.wa[k]).map(([, l]) => l);
    rows.push({ k: "WhatsApp", v: on.length ? `Automatic: ${on.join(", ")}` : "No automatic messages" });
  }
  if (has("opening")) {
    const cash = Number(money(f.opening.cash) || 0);
    const bank = Number(money(f.opening.bank) || 0);
    rows.push({ k: "Opening balances", v: cash || bank ? `Cash ${rupeesLabel(f.opening.cash)} · Bank ${rupeesLabel(f.opening.bank)}` : "Not set" });
  }
  if (has("start")) rows.push({ k: "Start", v: f.mode === "import" ? "Import members next" : "Empty gym" });
  return rows;
}

/** The plan kind the way the prototype guessed it: a name with "personal" or "PT" in it is personal training. */
export const planKind = (name: string) => (/personal|\bpt\b/i.test(name) ? ("Personal Training" as const) : ("Membership" as const));
