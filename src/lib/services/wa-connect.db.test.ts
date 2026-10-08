import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { hasDb, makeGym } from "@/test/db";
import { UserError } from "./errors";

// Meta's side is a stand-in: what matters here is what Fitron keeps, and for whom.
const meta = vi.hoisted(() => ({
  exchangeCode: vi.fn(),
  phoneInfo: vi.fn(),
  registerNumber: vi.fn(),
  subscribeApp: vi.fn(),
  submitTemplates: vi.fn(),
  templateStatuses: vi.fn(),
}));
vi.mock("@/lib/integrations/whatsapp-cloud", async (orig) => ({ ...(await orig<typeof import("@/lib/integrations/whatsapp-cloud")>()), ...meta }));

import { cloudTemplateStatus, connectCloud, disconnectCloud, resubmitTemplates } from "./wa-connect";
import { getCloudCreds, getCloudInfo } from "./wa-cloud-store";
import { getWaSettings, listTemplates, sendTest } from "./whatsapp";
import { putSetting } from "./settings";
import { exportOrg } from "./backup";

describe.skipIf(!hasDb)("a gym connects its own WhatsApp Business number (database)", () => {
  beforeEach(() => {
    for (const f of Object.values(meta)) f.mockReset();
    meta.exchangeCode.mockResolvedValue("BUSINESS-TOKEN-1");
    meta.phoneInfo.mockResolvedValue({ display_phone_number: "+91 98765 43210", verified_name: "Power Haus Gym" });
    meta.registerNumber.mockResolvedValue({});
    meta.subscribeApp.mockResolvedValue({});
    meta.submitTemplates.mockImplementation(async (_c: unknown, ts: { key: string; name: string }[]) => ts.map((t) => ({ key: t.key, name: t.name, ok: true })));
  });

  it("keeps the connection sealed, switches sending to it, submits templates and links each to its Meta name", async () => {
    const g = await makeGym();
    const admin = await g.user("Super Admin");
    const r = await connectCloud(admin, { code: "CODE", wabaId: "900001", phoneNumberId: "111111" });
    expect(r).toMatchObject({ number: "+91 98765 43210", name: "Power Haus Gym", failed: 0, warnings: [] });
    expect(meta.exchangeCode).toHaveBeenCalledWith("CODE");

    // The token is stored sealed, never in the clear, and the app can read it back for sending.
    const raw = JSON.stringify((await db.setting.findUniqueOrThrow({ where: { orgId_key: { orgId: g.org.id, key: "whatsapp_cloud" } } })).value);
    expect(raw).not.toContain("BUSINESS-TOKEN-1");
    expect(await getCloudCreds(g.org.id)).toEqual({ token: "BUSINESS-TOKEN-1", phoneNumberId: "111111", wabaId: "900001" });
    // What the screens may show has no secrets.
    expect(JSON.stringify(await getCloudInfo(g.org.id))).not.toMatch(/token|pin/i);

    expect(await getWaSettings(g.org.id)).toMatchObject({ mode: "cloud", linked: null });
    const tpls = await listTemplates(g.org.id);
    expect(tpls.find((t) => t.key === "exp7")!.metaTemplateName).toBe("fitron_exp7");
    expect(tpls.find((t) => t.key === "campaign")!.metaTemplateName).toBeNull();
    // The test message is submitted too, but is not a member template.
    expect(meta.submitTemplates.mock.calls[0]![1].some((t: { key: string }) => t.key === "test")).toBe(true);
    expect(await db.auditLog.count({ where: { orgId: g.org.id, action: "whatsapp.connect" } })).toBe(1);
  });

  it("keeps each gym's connection apart", async () => {
    const a = await makeGym();
    const b = await makeGym();
    await connectCloud(await a.user("Super Admin"), { code: "A", wabaId: "900001", phoneNumberId: "111111" });
    meta.exchangeCode.mockResolvedValue("BUSINESS-TOKEN-2");
    await connectCloud(await b.user("Super Admin"), { code: "B", wabaId: "900002", phoneNumberId: "222222" });
    expect((await getCloudCreds(a.org.id))!.token).toBe("BUSINESS-TOKEN-1");
    expect((await getCloudCreds(b.org.id))!.token).toBe("BUSINESS-TOKEN-2");
    expect(await getCloudCreds((await makeGym()).org.id)).toBeNull();
  });

  it("stores nothing when Meta refuses the code or the number cannot be read", async () => {
    const g = await makeGym();
    const admin = await g.user("Super Admin");
    meta.exchangeCode.mockRejectedValueOnce(new Error("Invalid verification code"));
    await expect(connectCloud(admin, { code: "BAD", wabaId: "900001", phoneNumberId: "111111" })).rejects.toThrow(/Invalid verification code/);
    meta.phoneInfo.mockRejectedValueOnce(new Error("no access"));
    await expect(connectCloud(admin, { code: "X", wabaId: "900001", phoneNumberId: "111111" })).rejects.toThrow(UserError);
    await expect(connectCloud(admin, { code: "X", wabaId: "not-an-id", phoneNumberId: "111111" })).rejects.toThrow(/did not finish/);
    expect(await getCloudInfo(g.org.id)).toBeNull();
    expect((await getWaSettings(g.org.id)).mode).toBe("demo");
  });

  it("still connects when switching the number on or the delivery receipts fail, and says so", async () => {
    const g = await makeGym();
    meta.registerNumber.mockRejectedValue(new Error("already registered"));
    meta.subscribeApp.mockRejectedValue(new Error("no permission"));
    const r = await connectCloud(await g.user("Super Admin"), { code: "CODE", wabaId: "900001", phoneNumberId: "111111" });
    expect(r.warnings).toEqual([expect.stringContaining("already registered"), expect.stringContaining("no permission")]);
    expect(await getCloudCreds(g.org.id)).not.toBeNull();
  });

  it("a template Meta refuses is listed, is not used for sending, and can be resubmitted", async () => {
    const g = await makeGym();
    const admin = await g.user("Super Admin");
    meta.submitTemplates.mockImplementationOnce(async (_c: unknown, ts: { key: string; name: string }[]) => ts.map((t) => (t.key === "exp3" ? { key: t.key, name: t.name, ok: false, error: "Content violates policy" } : { key: t.key, name: t.name, ok: true })));
    const r = await connectCloud(admin, { code: "CODE", wabaId: "900001", phoneNumberId: "111111" });
    expect(r.failed).toBe(1);
    expect((await listTemplates(g.org.id)).find((t) => t.key === "exp3")!.metaTemplateName).toBeNull();
    expect((await getCloudInfo(g.org.id))!.templates.find((t) => !t.ok)).toMatchObject({ key: "exp3", error: "Content violates policy" });
    expect(await resubmitTemplates(admin)).toEqual({ submitted: expect.any(Number), failed: 0 });
    expect((await listTemplates(g.org.id)).find((t) => t.key === "exp3")!.metaTemplateName).toBe("fitron_exp3");
  });

  it("the test message goes out as a template from the gym's own number", async () => {
    const g = await makeGym();
    const admin = await g.user("Super Admin");
    await putSetting(admin, "gym", { name: "Power Haus", phone: "9876543210" });
    await connectCloud(admin, { code: "CODE", wabaId: "900001", phoneNumberId: "111111" });
    const sent: unknown[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      sent.push({ url, auth: new Headers(init.headers).get("authorization"), body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ messages: [{ id: "wamid.9" }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const m = await sendTest(admin);
      expect(m.status).toBe("Sent");
      expect(sent).toEqual([expect.objectContaining({ auth: "Bearer BUSINESS-TOKEN-1", url: expect.stringContaining("/111111/messages"), body: expect.objectContaining({ type: "template", template: expect.objectContaining({ name: "fitron_test" }) }) })]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps the sealed connection out of backups", async () => {
    const g = await makeGym();
    await connectCloud(await g.user("Super Admin"), { code: "CODE", wabaId: "900001", phoneNumberId: "111111" });
    const text = (await exportOrg(g.org.id)).text;
    const settings = JSON.parse(text).tables.Setting as Record<string, unknown>[];
    expect(settings.length).toBeGreaterThan(0);
    expect(JSON.stringify(settings)).not.toContain("whatsapp_cloud");
    expect(text).not.toContain("BUSINESS-TOKEN");
  });

  it("counts approved, waiting and rejected templates, only this gym's own", async () => {
    const g = await makeGym();
    await connectCloud(await g.user("Super Admin"), { code: "CODE", wabaId: "900001", phoneNumberId: "111111" });
    meta.templateStatuses.mockResolvedValue([
      { name: "fitron_exp7", language: "en", status: "APPROVED" },
      { name: "fitron_due", language: "en", status: "PENDING" },
      { name: "fitron_exp3", language: "en", status: "REJECTED", reason: "TAG_CONTENT_MISMATCH" },
      { name: "someone_elses", language: "en", status: "APPROVED" },
    ]);
    expect(await cloudTemplateStatus(g.org.id)).toMatchObject({ approved: 1, pending: 1, rejected: 1 });
    meta.templateStatuses.mockRejectedValue(new Error("down"));
    expect(await cloudTemplateStatus(g.org.id)).toBeNull();
  });

  it("disconnecting deletes the token and the template links, and sending stops until it is connected again", async () => {
    const g = await makeGym();
    const admin = await g.user("Super Admin");
    await connectCloud(admin, { code: "CODE", wabaId: "900001", phoneNumberId: "111111" });
    await disconnectCloud(admin);
    expect(await getCloudCreds(g.org.id)).toBeNull();
    expect(await db.setting.count({ where: { orgId: g.org.id, key: "whatsapp_cloud" } })).toBe(0);
    expect((await listTemplates(g.org.id)).every((t) => t.metaTemplateName === null)).toBe(true);
    expect((await getWaSettings(g.org.id)).mode).toBe("demo");
  });
});
