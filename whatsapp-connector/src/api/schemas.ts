import { z } from "zod";

// Request shapes shared by the routes and the OpenAPI document.

export const phone = z.string().trim().min(6).max(20);
export const memberId = z.string().trim().min(1).max(64);
export const idempotencyKey = z.string().trim().min(1).max(128).optional();
export const isoDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

export const category = z.enum(["TRANSACTIONAL", "MARKETING"]);

export const sendBody = z.object({
  to: phone,
  message: z.string().min(1).max(4096),
  category: category.optional(),
  memberId: memberId.optional(),
  idempotencyKey,
  /** Optional variables for {{placeholders}} in message */
  variables: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).optional(),
});

export const documentBody = z.object({
  to: phone,
  caption: z.string().max(1024).optional().default(""),
  category: category.optional(),
  memberId: memberId.optional(),
  idempotencyKey,
});

export const listQuery = z.object({
  status: z.enum(["QUEUED", "PROCESSING", "SENT", "DELIVERED", "READ", "FAILED", "CANCELLED"]).optional(),
  messageType: z.enum(["TEXT", "DOCUMENT", "IMAGE", "PDF"]).optional(),
  recipient: z.string().trim().optional(),
  memberId: z.string().trim().optional(),
  date: isoDate.optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  ids: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 200) : undefined)),
  idempotencyKeys: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 200) : undefined)),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
});

export const consentBody = z.object({ phone, memberId: memberId.optional(), source: z.string().trim().max(64).optional() });

export const gymCreateBody = z.object({ name: z.string().trim().min(1).max(120), externalId: z.string().trim().min(1).max(64).optional(), phone: z.string().trim().max(20).optional(), timezone: z.string().trim().max(64).optional() });
export const gymPatchBody = z.object({ name: z.string().trim().min(1).max(120).optional(), phone: z.string().trim().max(20).nullable().optional(), timezone: z.string().trim().max(64).optional(), status: z.enum(["ACTIVE", "SUSPENDED"]).optional() });

export const templateBody = z.object({ body: z.string().min(1).max(4000), category: category.optional(), active: z.boolean().optional() });
export const previewBody = z.object({ body: z.string().min(1).max(4000), variables: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).optional() });

const fitronBase = { memberId, name: z.string().trim().min(1).max(120), phone, idempotencyKey, membershipPlan: z.string().trim().max(120).optional(), trainerName: z.string().trim().max(120).optional() };
export const membershipExpiryBody = z.object({ ...fitronBase, expiryDate: isoDate });
export const renewalReminderBody = z.object({ ...fitronBase, expiryDate: isoDate });
export const paymentReminderBody = z.object({ ...fitronBase, amount: z.coerce.number().nonnegative(), dueDate: isoDate });
export const paymentReceiptBody = z.object({ ...fitronBase, amount: z.coerce.number().nonnegative(), invoiceNumber: z.string().trim().max(64).optional(), date: isoDate.optional() });
export const welcomeBody = z.object({ ...fitronBase });
export const birthdayBody = z.object({ ...fitronBase });
export const attendanceBody = z.object({ ...fitronBase, date: isoDate.optional(), time: z.string().trim().max(16).optional() });
