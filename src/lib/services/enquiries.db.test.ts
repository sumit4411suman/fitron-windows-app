import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { hasDb } from "@/test/db";
import { contactSchema, trialRequestSchema } from "@/lib/validation/site";
import { createContactMessage, createTrialRequest } from "./enquiries";

describe.skipIf(!hasDb)("Website enquiries (database)", () => {
  it("saves a trial request with its plan and needs a gym name for gym plans only", async () => {
    vi.stubEnv("SMTP_HOST", "");
    const base = { name: "Asha Rao", email: "Asha@Example.com ", phone: "+91 98765 43210", cycle: "YEARLY", city: "Pune" };
    expect(trialRequestSchema.safeParse({ ...base, plan: "starter" }).error?.issues[0]?.message).toBe("Enter your gym's name.");
    const gym = await createTrialRequest(trialRequestSchema.parse({ ...base, plan: "starter", business: "Iron Den" }));
    const ai = await createTrialRequest(trialRequestSchema.parse({ ...base, plan: "ai-premium", cycle: "MONTHLY" }));
    const partner = await createTrialRequest(trialRequestSchema.parse({ ...base, plan: "partner-software", business: "Iron Den" }));
    const rows = await db.enquiry.findMany({ where: { id: { in: [gym.id, ai.id, partner.id] } } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(gym.id)).toMatchObject({ kind: "TRIAL", plan: "starter", cycle: "YEARLY", email: "asha@example.com", phone: "9876543210", business: "Iron Den" });
    expect(byId.get(ai.id)).toMatchObject({ kind: "TRIAL", plan: "ai-premium", cycle: "MONTHLY" });
    expect(byId.get(partner.id)?.kind).toBe("PARTNER");
  });

  it("rejects unknown plans and saves contact messages by topic", async () => {
    expect(trialRequestSchema.safeParse({ name: "Asha", email: "a@b.in", plan: "gold", cycle: "MONTHLY" }).success).toBe(false);
    expect(contactSchema.safeParse({ name: "Asha", email: "a@b.in", topic: "sales", message: "hi" }).success).toBe(false);
    const row = await createContactMessage(contactSchema.parse({ name: "Ravi", email: "ravi@gym.in", topic: "demo", message: "Please show me Gym Accounting." }));
    expect(row).toMatchObject({ kind: "SALES", message: "[Book a demo] Please show me Gym Accounting." });
  });
});
