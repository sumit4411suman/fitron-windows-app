import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { hasDb, makeGym } from "@/test/db";
import { UserError } from "./errors";

// Keep the support email from really sending, and keep what it would have said.
const mail = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; text: string }[] }));
vi.mock("@/lib/integrations/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations/email")>()),
  sendEmail: vi.fn(async (m: { to: string; subject: string; text: string }) => {
    mail.sent.push(m);
    return { sent: false };
  }),
}));

import { listTickets, raiseTicket, resolveTicket, systemDetails } from "./support";

const ctx = { userAgent: "Mozilla/5.0 (X11; Linux) Chrome/120 Safari/537", ip: "1.2.3.4" };
const input = { topic: "Question" as const, priority: "Normal" as const, subject: "Invoice PDF", message: "The PDF is blank here." };

afterEach(() => vi.unstubAllEnvs());

describe.skipIf(!hasDb)("Help & support (database)", () => {
  it("numbers tickets per gym, replies and audits", async () => {
    vi.stubEnv("SMTP_HOST", "");
    const g = await makeGym();
    const u = await g.user("Super Admin");
    const t1 = await raiseTicket(u, input, ctx);
    const t2 = await raiseTicket(u, { ...input, priority: "Urgent" }, ctx);
    expect([t1.number, t2.number]).toEqual(["TKT-1001", "TKT-1002"]);
    const g2 = await makeGym();
    expect((await raiseTicket(await g2.user("Super Admin"), input, ctx)).number).toBe("TKT-1001");
    const row = await db.supportTicket.findFirstOrThrow({ where: { id: t1.id }, include: { replies: true } });
    expect(row).toMatchObject({ status: "Open", userId: u.id, branchId: g.a.id, browser: "Chrome · Desktop", ip: "1.2.3.4", emailedAt: null });
    expect(row.appVersion).toBeTruthy();
    expect(row.replies).toHaveLength(1);
    expect(row.replies[0]).toMatchObject({ by: "Fitron Support", kind: "AUTO", text: "Thanks, we've got your request TKT-1001. We reply within 4 working hours." });
    const r2 = await db.supportTicketReply.findFirstOrThrow({ where: { ticketId: t2.id } });
    expect(r2.text).toContain("urgent tickets are picked up first");
    expect(await db.auditLog.count({ where: { orgId: g.org.id, action: "support.ticket.create", entity: "SupportTicket", entityId: "TKT-1001" } })).toBe(1);
  });

  it("marks a ticket from a priority-support plan, for the team and for the gym", async () => {
    vi.stubEnv("SMTP_HOST", "");
    mail.sent.length = 0;
    const g = await makeGym();
    const base = await g.user("Super Admin");
    const gyms = {
      enterprise: { ...base, plan: { key: "enterprise", name: "Enterprise", custom: false } },
      partner: { ...base, plan: { key: "partner-enterprise", name: "Enterprise Partner", custom: false } },
      starter: { ...base, plan: { key: "starter", name: "Starter", custom: false } },
      handmade: { ...base, plan: { key: "enterprise", name: "Enterprise", custom: true } },
    };
    const tickets: Record<string, Awaited<ReturnType<typeof raiseTicket>>> = {};
    for (const [k, u] of Object.entries(gyms)) tickets[k] = await raiseTicket(u, { ...input, subject: `From ${k}` }, ctx);

    const subject = (k: string) => mail.sent.find((m) => m.subject.includes(`From ${k}`))!.subject;
    const reply = async (k: string) => (await db.supportTicketReply.findFirstOrThrow({ where: { ticketId: tickets[k]!.id } })).text;
    for (const k of ["enterprise", "partner"]) {
      expect(subject(k), k).toContain("[PRIORITY PLAN]");
      expect(await reply(k), k).toContain("tickets on priority-support plans are picked up first");
    }
    for (const k of ["starter", "handmade"]) {
      expect(subject(k), k).not.toContain("PRIORITY");
      expect(await reply(k), k).not.toContain("priority-support");
    }
    expect(mail.sent.find((m) => m.subject.includes("From enterprise"))!.text).toContain("Plan: Enterprise (priority support: answer first)");
    expect(mail.sent.find((m) => m.subject.includes("From starter"))!.text).toContain("Plan: Starter\n");
  });

  it("lists only this gym's tickets, newest first", async () => {
    vi.stubEnv("SMTP_HOST", "");
    const g = await makeGym();
    const u = await g.user("Super Admin");
    await raiseTicket(u, input, ctx);
    await raiseTicket(u, { ...input, subject: "Second ticket" }, ctx);
    await raiseTicket(await (await makeGym()).user("Super Admin"), { ...input, subject: "Elsewhere" }, ctx);
    const list = await listTickets(g.org.id);
    expect(list.map((t) => t.subject)).toEqual(["Second ticket", "Invoice PDF"]);
    expect(list[0]).toMatchObject({ raisedBy: u.name });
    expect(list[0]!.latestReply).toContain("TKT-1002");
  });

  it("resolves once, audited, and not across gyms", async () => {
    vi.stubEnv("SMTP_HOST", "");
    const g = await makeGym();
    const u = await g.user("Super Admin");
    const t = await raiseTicket(u, input, ctx);
    await resolveTicket(u, t.id);
    await resolveTicket(u, t.id);
    const row = await db.supportTicket.findUniqueOrThrow({ where: { id: t.id } });
    expect(row).toMatchObject({ status: "Resolved", resolvedById: u.id });
    expect(row.resolvedAt).toBeTruthy();
    expect(await db.auditLog.count({ where: { orgId: g.org.id, action: "support.ticket.resolve" } })).toBe(1);
    const other = await (await makeGym()).user("Super Admin");
    await expect(resolveTicket(other, t.id)).rejects.toThrow(new UserError("Ticket not found."));
  });

  it("emails support when SMTP works and stores emailedAt", async () => {
    vi.resetModules();
    const send = vi.fn(async () => ({ sent: true as const }));
    vi.doMock("@/lib/integrations/email", () => ({ sendEmail: send, emailReady: () => true }));
    vi.stubEnv("SUPPORT_TO", "help@example.com");
    const svc = await import("./support");
    const g = await makeGym();
    const u = await g.user("Super Admin");
    const t = await svc.raiseTicket(u, input, ctx);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "help@example.com", replyTo: u.email }));
    expect((await db.supportTicket.findUniqueOrThrow({ where: { id: t.id } })).emailedAt).toBeTruthy();
    vi.doUnmock("@/lib/integrations/email");
    vi.resetModules();
  });

  it("reports system details", async () => {
    vi.stubEnv("SMTP_HOST", "");
    const g = await makeGym();
    const u = await g.user("Super Admin");
    const o = { userAgent: ctx.userAgent, ip: null, waStatusText: "Demo mode: messages are logged.", waMode: "demo" };
    const mk = (extra: object) => ({ orgId: g.org.id, branchId: g.a.id, name: "M", gender: "F", phone: "9876543210", source: "Walk-in", createdById: u.id, ...extra });
    await db.member.create({ data: mk({ code: "S-1" }) as never });
    await db.member.create({ data: mk({ code: "S-2", walkIn: true }) as never });
    await db.member.create({ data: mk({ code: "S-3", deletedAt: new Date() }) as never });
    const rows = await systemDetails(u, o);
    expect(rows.map((r) => r.k)).toEqual(["App version", "Gym", "Signed in as", "Plan", "Branches", "Members", "Browser", "File storage", "WhatsApp", "Email", "Database", "Daily jobs"]);
    const v = Object.fromEntries(rows.map((r) => [r.k, r.v]));
    expect(v["Branches"]).toBe("2");
    expect(v["Members"]).toBe("1");
    expect(v["Database"]).toBe("Connected");
    expect(v["Daily jobs"]).toBe("Never run");
    expect(v["WhatsApp"]).toMatch(/^Demo: log only · Demo mode/);
    await db.jobRun.create({ data: { orgId: g.org.id, name: "x", day: "2026-10-04", finishedAt: new Date(), result: {} } });
    expect((await systemDetails(u, o)).find((r) => r.k === "Daily jobs")!.v).toMatch(/^Last run /);
  });
});
