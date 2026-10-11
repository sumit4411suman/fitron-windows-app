import { Router, type Request, type Response } from "express";
import multer from "multer";
import type { z, ZodType } from "zod";
import type { Container } from "../../server/container.js";
import { gymAuth, gymOf } from "../../middleware/apiKeyAuth.js";
import { wrap } from "../../middleware/validate.js";
import type { TemplateVars } from "../../services/TemplateService.js";
import { attendanceBody, birthdayBody, membershipExpiryBody, paymentReceiptBody, paymentReminderBody, renewalReminderBody, welcomeBody } from "../schemas.js";

/** YYYY-MM-DD -> 15 Oct 2026, the way members read dates. */
export const prettyDate = (iso: string): string => {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};

export const prettyAmount = (n: number): string => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);

const today = () => new Date().toISOString().slice(0, 10);

type FitronEvent = { template: string; schema: ZodType; vars: (b: Record<string, unknown>) => TemplateVars; key: (b: Record<string, unknown>) => string };

/**
 * Fitron's own events, each rendered through the gym's template of the same name. Every call carries an idempotency
 * key (the caller's, or one derived from the event, member and date) so a retried webhook never sends twice.
 */
export const FITRON_EVENTS: Record<string, FitronEvent> = {
  "membership-expiry": { template: "membership-expiry", schema: membershipExpiryBody, vars: (b) => ({ expiryDate: prettyDate(String(b.expiryDate)) }), key: (b) => `membership-expiry:${b.memberId}:${b.expiryDate}:${today()}` },
  "renewal-reminder": { template: "renewal-reminder", schema: renewalReminderBody, vars: (b) => ({ expiryDate: prettyDate(String(b.expiryDate)) }), key: (b) => `renewal-reminder:${b.memberId}:${b.expiryDate}:${today()}` },
  "payment-reminder": { template: "payment-reminder", schema: paymentReminderBody, vars: (b) => ({ amount: prettyAmount(Number(b.amount)), dueDate: prettyDate(String(b.dueDate)) }), key: (b) => `payment-reminder:${b.memberId}:${b.dueDate}:${b.amount}:${today()}` },
  "payment-receipt": { template: "payment-receipt", schema: paymentReceiptBody, vars: (b) => ({ amount: prettyAmount(Number(b.amount)), invoiceNumber: String(b.invoiceNumber ?? ""), date: prettyDate(String(b.date ?? today())) }), key: (b) => `payment-receipt:${b.memberId}:${b.invoiceNumber ?? b.amount}:${b.date ?? today()}` },
  welcome: { template: "welcome", schema: welcomeBody, vars: () => ({}), key: (b) => `welcome:${b.memberId}` },
  birthday: { template: "birthday", schema: birthdayBody, vars: () => ({}), key: (b) => `birthday:${b.memberId}:${today().slice(0, 4)}` },
  attendance: { template: "attendance", schema: attendanceBody, vars: (b) => ({ date: prettyDate(String(b.date ?? today())), time: String(b.time ?? new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })) }), key: (b) => `attendance:${b.memberId}:${b.date ?? today()}:${b.time ?? ""}` },
};

export function fitronRoutes(c: Container): Router {
  const r = Router();
  r.use(gymAuth(c.gyms));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: c.env.MAX_MEDIA_BYTES, files: 1, fields: 20 } });

  const handle = (name: string) =>
    wrap(async (req: Request, res: Response) => {
      const ev = FITRON_EVENTS[name]!;
      const { gymId, gymName } = gymOf(req);
      const b = ev.schema.parse(req.body ?? {}) as z.infer<typeof welcomeBody> & Record<string, unknown>;
      const gym = await c.gyms.get(gymId);
      const vars: TemplateVars = { name: b.name, memberId: b.memberId, gymName, gymPhone: gym.phone ?? "", membershipPlan: b.membershipPlan ?? "", trainerName: b.trainerName ?? "", ...ev.vars(b) };
      const rendered = await c.templates.render(gymId, ev.template, vars);
      const file = req.file ? { buffer: req.file.buffer, mimeType: req.file.mimetype, fileName: req.file.originalname } : undefined;
      const { message, duplicate } = await c.messages.send({ gymId, to: b.phone, message: rendered.text, category: rendered.category, memberId: b.memberId, templateKey: ev.template, idempotencyKey: b.idempotencyKey ?? `fitron:${ev.key(b)}`, file });
      res.status(duplicate ? 200 : 202).json({ success: true, messageId: message.messageId, data: { ...message, duplicate } });
    });

  for (const name of Object.keys(FITRON_EVENTS)) {
    // payment-receipt may carry the invoice PDF as multipart "file"; the others are JSON.
    if (name === "payment-receipt") r.post(`/${name}`, upload.single("file"), handle(name));
    else r.post(`/${name}`, handle(name));
  }
  return r;
}
