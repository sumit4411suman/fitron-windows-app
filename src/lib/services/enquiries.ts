import "server-only";
import type * as z from "zod";
import "@/lib/zod-config";
import { db } from "@/lib/db";
import { findPlan, PRODUCT_LABEL, rupeesLabel } from "@/lib/domain/pricing";
import { sendEmail } from "@/lib/integrations/email";
import { TOPICS, type contactSchema, type trialRequestSchema } from "@/lib/validation/site";
import { log } from "@/lib/log";

// Website enquiries: saved first, then the team is emailed. A mail failure never loses the enquiry.

const teamInbox = () => process.env.ENQUIRY_TO?.trim() || "hello@fitron.in";

async function notify(subject: string, lines: (string | null | undefined)[], replyTo: string) {
  try {
    await sendEmail({ to: teamInbox(), subject, text: lines.filter(Boolean).join("\n"), replyTo });
  } catch (e) {
    log.error("enquiry.notify_failed", e);
  }
}

export async function createTrialRequest(d: z.infer<typeof trialRequestSchema>) {
  const plan = findPlan(d.plan)!;
  const row = await db.enquiry.create({
    data: { kind: plan.product === "PARTNER" ? "PARTNER" : "TRIAL", plan: plan.key, cycle: d.cycle, name: d.name, email: d.email, phone: d.phone, business: d.business, city: d.city },
  });
  await notify(
    `${plan.product === "PARTNER" ? "Partner request" : "Free trial"}: ${PRODUCT_LABEL[plan.product]} ${plan.name}, ${d.business ?? d.name}`,
    [
      `Plan: ${PRODUCT_LABEL[plan.product]} ${plan.name}, ${d.cycle === "YEARLY" ? "yearly" : "monthly"} (${rupeesLabel(plan.price[d.cycle])}, GST included)`,
      `Name: ${d.name}`,
      `Email: ${d.email}`,
      d.phone && `Phone: ${d.phone}`,
      d.business && `Business: ${d.business}`,
      d.city && `City: ${d.city}`,
      `Reference: ${row.id}`,
    ],
    d.email,
  );
  return row;
}

export async function createContactMessage(d: z.infer<typeof contactSchema>) {
  const kind = d.topic === "sales" || d.topic === "demo" ? "SALES" : d.topic === "partner" ? "PARTNER" : "CONTACT";
  const row = await db.enquiry.create({ data: { kind, name: d.name, email: d.email, phone: d.phone, business: d.business, message: `[${TOPICS[d.topic]}] ${d.message}` } });
  await notify(
    `Website message: ${TOPICS[d.topic]} from ${d.name}`,
    [`Name: ${d.name}`, `Email: ${d.email}`, d.phone && `Phone: ${d.phone}`, d.business && `Business: ${d.business}`, "", d.message, "", `Reference: ${row.id}`],
    d.email,
  );
  return row;
}
