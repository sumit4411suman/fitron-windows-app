import type { MessageCategory, PrismaClient, Template } from "../generated/prisma/index.js";
import { AppError } from "../utils/errors.js";

// Templates: plain text with {{variable}} placeholders. There is no expression language on purpose: a placeholder is
// looked up in the variables map and nothing else is evaluated.

export const TEMPLATE_VARIABLES = ["name", "gymName", "expiryDate", "dueDate", "amount", "membershipPlan", "trainerName", "gymPhone", "date", "memberId", "invoiceNumber", "time"] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
export type TemplateVars = Partial<Record<TemplateVariable, string | number | null | undefined>>;

export type DefaultTemplate = { name: string; body: string; category: MessageCategory };

export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  { name: "welcome", category: "TRANSACTIONAL", body: "Welcome to {{gymName}}, {{name}}! We are glad to have you with us. Save this number for updates about your membership. Reply STOP to opt out of messages." },
  { name: "membership-expiry", category: "TRANSACTIONAL", body: "Hello {{name}}, your {{membershipPlan}} membership at {{gymName}} expires on {{expiryDate}}. Please contact your gym for renewal." },
  { name: "payment-reminder", category: "TRANSACTIONAL", body: "Hello {{name}}, a payment of ₹{{amount}} for your {{gymName}} membership is due on {{dueDate}}. Please pay at the front desk or contact {{gymPhone}}." },
  { name: "payment-receipt", category: "TRANSACTIONAL", body: "Hello {{name}}, we received your payment of ₹{{amount}} at {{gymName}}. Thank you! Your receipt is attached." },
  { name: "renewal-reminder", category: "TRANSACTIONAL", body: "Hello {{name}}, your {{membershipPlan}} membership at {{gymName}} ended on {{expiryDate}}. Renew today to keep training with us. Call {{gymPhone}} for plans." },
  { name: "attendance", category: "TRANSACTIONAL", body: "Hi {{name}}, your attendance at {{gymName}} was marked on {{date}} at {{time}}. Keep it up!" },
  { name: "birthday", category: "MARKETING", body: "Happy birthday, {{name}}! Everyone at {{gymName}} wishes you a great year ahead. Come celebrate with a workout!" },
];

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function placeholdersIn(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(PLACEHOLDER)) if (m[1]) out.add(m[1]);
  return [...out];
}

/** Rejects unknown placeholders and anything that looks like code. */
export function validateTemplateBody(body: string): void {
  if (typeof body !== "string" || !body.trim()) throw new AppError("INVALID_TEMPLATE", "Template body is empty.");
  if (body.length > 4000) throw new AppError("INVALID_TEMPLATE", "Template body is too long (max 4000 characters).");
  if (/\{\{[^}]*[^a-zA-Z0-9_\s}][^}]*\}\}/.test(body) || /\$\{|<%|<script/i.test(body)) throw new AppError("INVALID_TEMPLATE", "Templates may only contain plain {{variable}} placeholders.");
  const unknown = placeholdersIn(body).filter((p) => !(TEMPLATE_VARIABLES as readonly string[]).includes(p));
  if (unknown.length) throw new AppError("INVALID_TEMPLATE", `Unknown template variable(s): ${unknown.map((u) => `{{${u}}}`).join(", ")}.`, { allowed: TEMPLATE_VARIABLES });
}

/** Fills placeholders. Missing variables become an empty string, never the placeholder itself. */
export function renderTemplate(body: string, vars: TemplateVars): string {
  validateTemplateBody(body);
  return body.replace(PLACEHOLDER, (_m, key: string) => {
    const v = vars[key as TemplateVariable];
    return v === null || v === undefined ? "" : String(v);
  });
}

export type TemplateView = { name: string; body: string; category: MessageCategory; active: boolean; isDefault: boolean; updatedAt: Date | null };

export class TemplateService {
  constructor(private readonly db: PrismaClient) {}

  /** The gym's templates, falling back to the built-in defaults for any it has not customised. */
  async list(gymId: string): Promise<TemplateView[]> {
    const rows = await this.db.template.findMany({ where: { gymId } });
    const byName = new Map(rows.map((r) => [r.name, r]));
    const out: TemplateView[] = DEFAULT_TEMPLATES.map((d) => {
      const r = byName.get(d.name);
      return r ? view(r) : { name: d.name, body: d.body, category: d.category, active: true, isDefault: true, updatedAt: null };
    });
    for (const r of rows) if (!DEFAULT_TEMPLATES.some((d) => d.name === r.name)) out.push(view(r));
    return out;
  }

  async get(gymId: string, name: string): Promise<TemplateView> {
    const r = await this.db.template.findUnique({ where: { gymId_name: { gymId, name } } });
    if (r) return view(r);
    const d = DEFAULT_TEMPLATES.find((t) => t.name === name);
    if (!d) throw new AppError("TEMPLATE_NOT_FOUND", `Template "${name}" not found.`);
    return { name: d.name, body: d.body, category: d.category, active: true, isDefault: true, updatedAt: null };
  }

  async upsert(gymId: string, name: string, data: { body: string; category?: MessageCategory; active?: boolean }): Promise<TemplateView> {
    validateTemplateBody(data.body);
    if (!/^[a-z0-9-]{2,50}$/.test(name)) throw new AppError("VALIDATION_ERROR", "Template name must be 2-50 lowercase letters, digits or dashes.");
    const def = DEFAULT_TEMPLATES.find((t) => t.name === name);
    const r = await this.db.template.upsert({
      where: { gymId_name: { gymId, name } },
      create: { gymId, name, body: data.body, category: data.category ?? def?.category ?? "TRANSACTIONAL", active: data.active ?? true },
      update: { body: data.body, ...(data.category ? { category: data.category } : {}), ...(data.active !== undefined ? { active: data.active } : {}) },
    });
    return view(r);
  }

  /** Back to the built-in text. */
  async reset(gymId: string, name: string): Promise<TemplateView> {
    await this.db.template.deleteMany({ where: { gymId, name } });
    return this.get(gymId, name);
  }

  /** Renders a named template for a gym; throws if it is inactive. */
  async render(gymId: string, name: string, vars: TemplateVars): Promise<{ text: string; category: MessageCategory }> {
    const t = await this.get(gymId, name);
    if (!t.active) throw new AppError("INVALID_TEMPLATE", `Template "${name}" is switched off for this gym.`);
    return { text: renderTemplate(t.body, vars), category: t.category };
  }
}

const view = (r: Template): TemplateView => ({ name: r.name, body: r.body, category: r.category, active: r.active, isDefault: false, updatedAt: r.updatedAt });
