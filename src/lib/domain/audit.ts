import type { Prisma } from "@/generated/prisma/client";
import { formatRupees } from "@/lib/format";

/** How serious an audit entry is, from its action, as in the prototype's audit log. */
export type Severity = "High" | "Medium" | "Low";

/** Reversals, cancellations, deletions, restores, unlocks, overrides, role and password changes. */
export const HIGH_WORDS = ["reverse", "cancel", "delete", "remove", "unlock", "void", "override", "role", "deactivate", "erase", "restore", "password"];
/** Edits to existing records, locks, settings and sign-ins. */
export const MEDIUM_WORDS = ["update", "lock", "setting", "suspend", "price", "transfer", "payroll", "salary", "login"];

export function severityOf(action: string, entity = ""): Severity {
  const a = `${action} ${entity}`.toLowerCase();
  if (HIGH_WORDS.some((w) => a.includes(w))) return "High";
  if (MEDIUM_WORDS.some((w) => a.includes(w))) return "Medium";
  return "Low";
}

type Mod = { name: string; entities: string[]; actionPrefixes: string[] };
/** The prototype's modules, in its order. */
export const MODULES: Mod[] = [
  { name: "Access", entities: ["Session"], actionPrefixes: ["auth.", "profile.password", "staff.role"] },
  { name: "Members", entities: ["Member", "Membership", "MemberDocument", "Document", "ProgressLog", "PersonalRecord", "Lead"], actionPrefixes: [] },
  { name: "Invoices", entities: ["Invoice"], actionPrefixes: [] },
  { name: "Payments", entities: ["Payment", "AutopayMandate"], actionPrefixes: [] },
  { name: "Accounts", entities: ["Expense", "MonthLock", "Asset", "Purchase", "SalaryPayment"], actionPrefixes: [] },
  { name: "WhatsApp", entities: ["WhatsAppTemplate", "WhatsAppMessage"], actionPrefixes: ["whatsapp."] },
  { name: "POS", entities: ["Product"], actionPrefixes: [] },
  { name: "Attendance", entities: ["Attendance", "ClassSlot", "Booking"], actionPrefixes: [] },
  { name: "Staff & devices", entities: ["User", "Role", "Device"], actionPrefixes: [] },
  { name: "Settings", entities: ["Setting", "Branch", "MembershipPlan", "Offer", "BranchSubscription", "Import", "Backup", "SupportTicket", "Organization"], actionPrefixes: [] },
  { name: "Other", entities: [], actionPrefixes: [] },
];
export const AUDIT_MODULES = MODULES.map((m) => m.name);

/** The module of an entry: an action prefix wins over the record type. */
export function moduleOf(entity: string, action = "") {
  return MODULES.find((m) => m.actionPrefixes.some((p) => action.startsWith(p)))?.name ?? MODULES.find((m) => m.entities.includes(entity))?.name ?? "Other";
}
/** Record types in a module. */
export const entitiesOf = (module: string) => MODULES.find((m) => m.name === module)?.entities ?? [];

/** SQL form of moduleOf, so the module filter applies before pagination. */
export function moduleWhere(name: string): Prisma.AuditLogWhereInput {
  const starts = (ps: string[]) => ps.map((p) => ({ action: { startsWith: p } }));
  const others = MODULES.filter((m) => m.name !== name);
  const otherPrefixes = starts(others.flatMap((m) => m.actionPrefixes));
  if (name === "Other") return { NOT: { OR: [...starts(MODULES.flatMap((m) => m.actionPrefixes)), { entity: { in: MODULES.flatMap((m) => m.entities) } }] } };
  const mod = MODULES.find((m) => m.name === name);
  if (!mod) return {};
  return { OR: [...starts(mod.actionPrefixes), { entity: { in: mod.entities }, ...(otherPrefixes.length ? { NOT: { OR: otherPrefixes } } : {}) }] };
}

/** "Chrome · Windows · 1.2.3.4" from the user agent and IP. */
export function deviceLabel(userAgent: string | null | undefined, ip: string | null | undefined, actorType = "USER") {
  if (!userAgent) return actorType === "SYSTEM" ? ["Automatic", ip].filter(Boolean).join(" · ") : ip || "—";
  const ua = userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\/|CriOS/.test(ua) ? "Chrome" : /Firefox\/|FxiOS/.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : "";
  return [browser, os, ip].filter(Boolean).join(" · ");
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type DescribeInput = { action: string; entity: string; entityId: string; before?: unknown; after?: unknown; extra?: { branchName?: string; userName?: string } };

const VERBS: Record<string, string> = { create: "Added", update: "Edited", delete: "Deleted", remove: "Deleted" };

type Ctx = { a: Obj; b: Obj; id: string; extra: NonNullable<DescribeInput["extra"]>; ref: string; name: string; reason: string };

const word = (s: string, n: string) => (n ? `${s} ${n}` : s);
const withRef = (verb: string, noun: string) => (c: Ctx) => `${verb} ${noun} ${c.ref || c.id}`.trim();
const named = (verb: string, noun: string) => (c: Ctx) => `${verb} ${noun} ${c.name || c.ref || c.id}`.trim();
const member = (verb: string) => (c: Ctx) => `${verb} member ${[str(c.a.name) || str(c.b.name), (c.ref && `(${c.ref})`) || ""].filter(Boolean).join(" ")}`.trim();
const rupees = (v: unknown) => formatRupees(Number(v) || 0);

const SENTENCES: Record<string, (c: Ctx) => string> = {
  "auth.login": (c) => `Signed in via ${c.a.via === "google" ? "Google" : c.a.via === "email-link" ? "an emailed link" : c.a.via === "email-code" ? "an emailed code" : "password"}`,
  "auth.logout": () => "Signed out",
  "auth.idle-signout": () => "Signed out after sitting idle",
  "profile.password": () => "Changed own password",
  "profile.update": () => "Edited own profile",
  "profile.photo": () => "Changed profile photo",
  "profile.photo.remove": () => "Removed profile photo",
  "member.create": (c) => `Added a new member ${[str(c.a.name), c.ref && `(${c.ref})`].filter(Boolean).join(" ")}`.trim(),
  "member.update": (c) => {
    const fields = Object.keys(c.a).filter((k) => !["updatedAt", "createdAt", "id", "orgId"].includes(k) && JSON.stringify(c.a[k]) !== JSON.stringify(c.b[k])).slice(0, 3);
    return `${member("Edited")(c)}${fields.length ? `: ${fields.join(", ")}` : ""}`;
  },
  "member.delete": (c) => member("Deleted")(c) + c.reason,
  "member.restore": member("Restored"),
  "member.transfer": (c) => `${member("Transferred")(c)} to ${c.extra.branchName ?? "another branch"}`,
  "member.suspend": member("Suspended"),
  "member.resume": member("Resumed"),
  "member.import": member("Imported"),
  "member.programs": member("Assigned programs to"),
  "member.biometric-consent": member("Recorded biometric consent for"),
  "member.biometric-enrol": member("Enrolled biometrics for"),
  "member.biometric-erase": member("Erased biometric data of"),
  "member.erase": (c) => member("Erased personal data of")(c) + c.reason,
  "member.export": member("Exported personal data of"),
  "membership.create": (c) => `Sold membership ${str(obj(c.a.membership).code) || c.id} with invoice ${str(obj(c.a.invoice).number)}`.trim(),
  "membership.renew": (c) => `Renewed membership ${str(obj(c.a.membership).code) || c.id} with invoice ${str(obj(c.a.invoice).number)}`.trim(),
  "membership.freeze": (c) => `Froze membership ${c.ref || c.id}`,
  "membership.unfreeze": (c) => `Unfroze membership ${c.ref || c.id}`,
  "document.upload": named("Uploaded", "document"),
  "document.view": named("Viewed", "document"),
  "document.replace": named("Replaced", "document"),
  "document.delete": named("Deleted", "document"),
  "invoice.create": (c) => `Generated invoice ${str(obj(c.a.invoice).number) || str(c.a.number) || c.id}${c.a.payment ? ` and recorded payment ${str(obj(c.a.payment).code)} of ${rupees(obj(c.a.payment).amount)}` : ""}`,
  "invoice.cancel": (c) => `Cancelled invoice ${str(c.a.number) || str(c.b.number) || c.id}${c.reason}`,
  "pos.sale": (c) => `Sold at POS with invoice ${str(obj(c.a.invoice).number) || str(c.a.number) || c.id}`,
  "payment.create": (c) => `Recorded payment ${c.ref || c.id} of ${rupees(c.a.amount)} (${str(c.a.method)})${str(c.a.invoiceNumber) ? ` against ${str(c.a.invoiceNumber)}` : ""}`,
  "payment.reverse": (c) => `Reversed payment ${c.ref || c.id} of ${rupees(c.a.amount ?? c.b.amount)}${c.reason}`,
  "autopay.create": (c) => `Set up autopay mandate ${c.ref || c.id}`,
  "autopay.charged": (c) => `Autopay charged ${rupees(c.a.amount)} on mandate ${c.ref || c.id}`,
  "autopay.approve-demo": (c) => `Approved autopay mandate ${c.ref || c.id} (demo)`,
  "expense.create": (c) => `Recorded expense ${c.ref || c.id} of ${rupees(c.a.amount)}`,
  "expense.update": withRef("Edited", "expense"),
  "expense.void": (c) => `Voided expense ${c.ref || c.id}${c.reason}`,
  "expense.import": withRef("Imported", "expense"),
  "month.lock": (c) => monthSentence("Locked", c),
  "month.unlock": (c) => monthSentence("Unlocked", c),
  "asset.create": named("Added", "asset"),
  "asset.update": named("Edited", "asset"),
  "asset.sold": named("Sold", "asset"),
  "asset.scrapped": named("Scrapped", "asset"),
  "asset.remove": named("Removed", "asset"),
  "asset.undo-disposal": named("Undid the disposal of", "asset"),
  "purchase.create": withRef("Recorded", "purchase"),
  "purchase.pay": (c) => `Paid ${rupees(c.a.amount)} on purchase ${c.ref || c.id}`,
  "purchase.cancel": (c) => `Cancelled purchase ${c.ref || c.id}${c.reason}`,
  "whatsapp.template": (c) => `Edited WhatsApp template ${c.id}`,
  "whatsapp.rule": (c) => `Edited WhatsApp automation rule ${c.id}`,
  "whatsapp.link": () => "Linked WhatsApp",
  "whatsapp.unlink": () => "Unlinked WhatsApp",
  "whatsapp.campaign": (c) => `Sent WhatsApp campaign to ${str(c.a.recipients) || "0"} members (${str(c.a.sent) || "0"} sent, ${str(c.a.failed) || "0"} failed)`,
  "whatsapp.automation.run": (c) => `Ran WhatsApp automation ${c.id}`,
  "product.create": (c) => `Added product ${[c.ref, str(c.a.name)].filter((x, i, arr) => x && arr.indexOf(x) === i).join(" ")}`.trim(),
  "product.update": withRef("Edited", "product"),
  "product.stock": withRef("Adjusted stock of", "product"),
  "product.activate": withRef("Activated", "product"),
  "product.deactivate": withRef("Deactivated", "product"),
  "product.import": withRef("Imported", "product"),
  "attendance.override": (c) => `Overrode the check-in block for member ${str(c.a.member) || c.id}${str(c.a.reason) ? `: ${str(c.a.reason)}` : ""}`,
  "attendance.remove": (c) => `Removed check-in ${c.id}`,
  "class.create": named("Added", "class"),
  "class.update": named("Edited", "class"),
  "class.activate": named("Activated", "class"),
  "class.deactivate": named("Deactivated", "class"),
  "booking.create": (c) => `Booked ${c.name || c.id}`,
  "booking.status": (c) => `Updated booking status to ${str(c.a.status)}`.trim(),
  "booking.promote": () => "Promoted a waitlisted booking",
  "booking.attendedAll": (c) => `Marked everyone attended for class ${c.id}`,
  "staff.create": named("Added", "staff"),
  "staff.update": (c) => `Edited staff ${c.name || c.id}${c.a.passwordReset ? " and reset the password" : ""}`,
  "staff.role": (c) => (c.name ? `Changed the role of staff ${c.name}` : `Changed the role of a staff member${str(c.a.role) ? ` to ${str(c.a.role)}` : ""}`),
  "staff.role-password-failed": (c) => `Entered a wrong password confirming a role change for staff ${c.name || c.id}`,
  "staff.activate": named("Activated", "staff"),
  "staff.deactivate": named("Deactivated", "staff"),
  "staff.salary": named("Set the salary of", "staff"),
  "payroll.pay": (c) => `Paid salary${c.a.amount != null ? ` of ${rupees(c.a.amount)}` : ""}`,
  "payroll.advance": (c) => `Gave a salary advance${c.a.amount != null ? ` of ${rupees(c.a.amount)}` : ""}`,
  "payroll.advance.settle": () => "Settled a salary advance",
  "device.add": (c) => `Added device ${c.name || c.id}`,
  "device.update": (c) => `Edited device ${c.name || c.id}`,
  "device.remove": (c) => `Removed device ${c.name || c.id}`,
  "device.open-door": (c) => `Opened the door remotely on device ${c.id}`,
  "setting.update": (c) => `Changed settings: ${c.id}`,
  "gym.logo": () => "Changed the gym logo",
  "gym.logo.remove": () => "Removed the gym logo",
  "branch.create": named("Added", "branch"),
  "branch.update": named("Edited", "branch"),
  "branch.activate": named("Activated", "branch"),
  "branch.deactivate": named("Deactivated", "branch"),
  "branch.delete": named("Deleted", "branch"),
  "plan.create": named("Added", "plan"),
  "plan.update": named("Edited", "plan"),
  "plan.delete": named("Deleted", "plan"),
  "plan.activate": named("Activated", "plan"),
  "plan.deactivate": named("Deactivated", "plan"),
  "offer.create": withRef("Added", "offer"),
  "offer.pause": withRef("Paused", "offer"),
  "offer.activate": withRef("Activated", "offer"),
  "billing.utr-submitted": () => "Submitted a bank transfer reference for the subscription",
  "billing.utr-rejected": (c) => `FITRON could not match the bank transfer${str(c.a.reviewedBy) ? ` (checked by ${str(c.a.reviewedBy)})` : ""}${str(c.a.rejectReason) ? ` · reason: ${str(c.a.rejectReason)}` : ""}`,
  "billing.plan-paid": () => "Subscription plan paid",
  "billing.branch-paid": () => "Branch slot paid",
  "lead.create": named("Added", "enquiry"),
  "lead.update": named("Edited", "enquiry"),
  "lead.stage": (c) => `Moved enquiry ${c.name || c.id} to ${str(c.a.stage)}`.trim(),
  "lead.won": (c) => `Converted enquiry ${c.name || c.id} to a member`,
  "lead.call": named("Called", "enquiry"),
  "lead.message": named("Messaged", "enquiry"),
  "ai.proposal.send": () => "Sent an AI Trainer proposal",
  "ai.proposal.confirm": (c) => `Confirmed a Fitron AI draft: ${str(c.a.summary) || c.id}`,
  "workout.create": named("Added", "workout plan"),
  "workout.update": named("Edited", "workout plan"),
  "diet.create": named("Added", "diet plan"),
  "diet.update": named("Edited", "diet plan"),
  "support.ticket.create": (c) => `Raised support ticket ${c.id}`,
  "support.ticket.resolve": (c) => `Resolved support ticket ${c.id}`,
  "backup.create": () => "Created a backup",
  "backup.download": () => "Downloaded a backup",
  "backup.restore": () => "Restored a backup",
  "backup.prune": () => "Removed old backups",
  "demo.clear": () => "Cleared the demo data",
};

function monthSentence(verb: string, c: Ctx) {
  const m = c.id.split(":")[1] ?? "";
  const label = /^\d{4}-\d{2}$/.test(m) ? `${MON[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}` : m;
  return `${verb} accounting month ${label}${c.extra.branchName ? ` · ${c.extra.branchName}` : ""}`.trim();
}

const refOf = (a: Obj, b: Obj) => {
  for (const o of [a, b]) for (const k of ["code", "number", "sku", "name"]) if (str(o[k])) return str(o[k]);
  return "";
};

/** Reads the changed entry as a sentence ("Recorded payment PAY-5001 of ₹2,000 (UPI) against INV-1024"). */
export function describeAudit(e: DescribeInput): string {
  const a = obj(e.after);
  const b = obj(e.before);
  const r = ["cancelReason", "reverseReason", "voidReason", "deleteReason", "reason"].map((k) => str(a[k]) || str(b[k])).find(Boolean);
  const c: Ctx = { a, b, id: e.entityId, extra: e.extra ?? {}, ref: refOf(a, b), name: str(a.name) || str(b.name), reason: r ? ` · reason: ${r}` : "" };
  const fn = SENTENCES[e.action];
  if (fn) return fn(c);
  if (e.action.startsWith("autopay.")) return `Updated autopay mandate ${c.ref || c.id}`;
  if (e.action.startsWith("export.")) return `Exported ${e.action.slice(7)}`;
  if (e.action.startsWith("import.")) return `Imported ${str(a.rows) || "0"} ${e.action.slice(7)} from ${str(a.file) || "a file"}`;
  return fallbackSentence(e.action, e.entity, c.ref || c.id);
}

export function fallbackSentence(action: string, entity: string, ref: string) {
  const last = action.split(".").pop() ?? action;
  const verb = VERBS[last] ?? last.charAt(0).toUpperCase() + last.slice(1);
  return word(`${verb} ${entity}`, ref);
}

/** True when describeAudit knows this action key (used by the test over every key the app writes). */
export const isKnownAction = (action: string) => action in SENTENCES || /^(autopay|export|import)\./.test(action);
