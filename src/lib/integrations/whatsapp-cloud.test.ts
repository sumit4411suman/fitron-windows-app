import { afterEach, describe, expect, it, vi } from "vitest";
import type { MetaTemplate } from "@/lib/domain/wa-meta";

type Call = { url: string; method: string; auth: string | null; body: unknown };
let calls: Call[] = [];
let respond: (c: Call) => { status?: number; json: unknown } = () => ({ json: {} });

vi.stubGlobal(
  "fetch",
  vi.fn(async (url: string | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const raw = init?.body;
    const c: Call = { url: String(url), method: init?.method ?? "GET", auth: headers.get("authorization"), body: typeof raw === "string" ? JSON.parse(raw) : raw };
    calls.push(c);
    const r = respond(c);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  }),
);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  calls = [];
  respond = () => ({ json: {} });
});

const load = async () => ({ wa: await import("./whatsapp"), cloud: await import("./whatsapp-cloud") });
const gymA = { phoneNumberId: "111111", wabaId: "900001", token: "TOKEN-A" };
const gymB = { phoneNumberId: "222222", wabaId: "900002", token: "TOKEN-B" };

describe("WhatsApp Business, one connection per gym", () => {
  it("sends from the gym's own number with the gym's own token", async () => {
    respond = () => ({ json: { messages: [{ id: "wamid.1" }] } });
    const { wa } = await load();
    const r = await wa.sendWhatsApp("cloud", { orgId: "a", cloud: gymA, localId: "m1", to: "919876543210", body: "Hi", template: { name: "fitron_exp7", language: "en", params: ["Rahul", "31 Dec"] } });
    expect(r).toEqual({ status: "Sent", providerMessageId: "wamid.1" });
    await wa.sendWhatsApp("cloud", { orgId: "b", cloud: gymB, localId: "m2", to: "919876543210", body: "Hi" });
    expect(calls.map((c) => [c.url.split("/").slice(-2).join("/"), c.auth])).toEqual([
      ["111111/messages", "Bearer TOKEN-A"],
      ["222222/messages", "Bearer TOKEN-B"],
    ]);
    expect(calls[0]!.body).toMatchObject({ to: "919876543210", type: "template", template: { name: "fitron_exp7", language: { code: "en" } } });
  });

  it("puts an invoice in the template's document header only when the template has one", async () => {
    respond = (c) => ({ json: c.url.endsWith("/media") ? { id: "media1" } : { messages: [{ id: "wamid.2" }] } });
    const { wa } = await load();
    const pdf = { bytes: new Uint8Array([1, 2, 3]), filename: "INV-1.pdf" };
    await wa.sendWhatsApp("cloud", { orgId: "a", cloud: gymA, localId: "m1", to: "919876543210", body: "x", pdf, template: { name: "fitron_invoice", language: "en", params: ["Rahul"], docHeader: true } });
    await wa.sendWhatsApp("cloud", { orgId: "a", cloud: gymA, localId: "m2", to: "919876543210", body: "x", pdf, template: { name: "fitron_due", language: "en", params: ["Rahul"] } });
    const sent = calls.filter((c) => c.url.endsWith("/messages")).map((c) => (c.body as { template: { components: { type: string }[] } }).template.components.map((x) => x.type));
    expect(sent).toEqual([["header", "body"], ["body"]]);
  });

  it("says the gym has not connected, instead of sending from nobody's number", async () => {
    vi.stubEnv("WHATSAPP_TOKEN", "");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "");
    const { wa } = await load();
    expect(await wa.sendWhatsApp("cloud", { orgId: "a", localId: "m1", to: "919876543210", body: "Hi" })).toMatchObject({ status: "Failed", error: expect.stringMatching(/not connected/i) });
    expect(calls).toEqual([]);
  });

  it("falls back to the server-wide number when the Fitron team set one", async () => {
    vi.stubEnv("WHATSAPP_TOKEN", "SHARED");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "333333");
    respond = () => ({ json: { messages: [{ id: "wamid.3" }] } });
    const { wa } = await load();
    await wa.sendWhatsApp("cloud", { orgId: "a", localId: "m1", to: "919876543210", body: "Hi" });
    expect([calls[0]!.url.split("/").slice(-2).join("/"), calls[0]!.auth]).toEqual(["333333/messages", "Bearer SHARED"]);
  });

  it("shows Meta's own words when it refuses a message", async () => {
    respond = () => ({ status: 400, json: { error: { message: "(#132001) Template name does not exist", error_user_msg: "That template is not approved yet." } } });
    const { wa } = await load();
    expect(await wa.sendWhatsApp("cloud", { orgId: "a", cloud: gymA, localId: "m1", to: "919876543210", body: "Hi" })).toEqual({ status: "Failed", error: "That template is not approved yet." });
  });

  it("the Connect button needs the Meta app set up on the server", async () => {
    vi.stubEnv("META_APP_ID", "");
    expect((await load()).cloud.signupConfig()).toBeNull();
    vi.stubEnv("META_APP_ID", "123");
    vi.stubEnv("META_ES_CONFIG_ID", "456");
    vi.stubEnv("WHATSAPP_APP_SECRET", "s3cret");
    expect((await load()).cloud.signupConfig()).toEqual({ appId: "123", configId: "456", version: "v21.0" });
  });

  it("turns the pop-up's code into the gym's token with the app's id and secret", async () => {
    vi.stubEnv("META_APP_ID", "123");
    vi.stubEnv("WHATSAPP_APP_SECRET", "s3cret");
    respond = () => ({ json: { access_token: "BUSINESS-TOKEN" } });
    const { cloud } = await load();
    expect(await cloud.exchangeCode("CODE1")).toBe("BUSINESS-TOKEN");
    const q = new URL(calls[0]!.url).searchParams;
    expect([q.get("client_id"), q.get("client_secret"), q.get("code")]).toEqual(["123", "s3cret", "CODE1"]);
    respond = () => ({ status: 400, json: { error: { message: "Invalid verification code" } } });
    await expect(cloud.exchangeCode("BAD")).rejects.toThrow(/Invalid verification code/);
  });

  it("submits each template on its own: one Meta refuses, or that is already there, never stops the rest", async () => {
    const t = (key: string, extra: Partial<MetaTemplate> = {}): MetaTemplate => ({ key, name: `fitron_${key}`, language: "en", category: "UTILITY", text: "Hi {{1}}.", vars: ["member_name"], examples: ["Rahul"], docHeader: false, ...extra });
    respond = (c) => {
      const name = (c.body as { name: string }).name;
      if (name === "fitron_b") return { status: 400, json: { error: { message: "Content violates policy" } } };
      if (name === "fitron_c") return { status: 400, json: { error: { message: "Template name already exists in this language" } } };
      return { json: { id: "1", status: "PENDING" } };
    };
    const { cloud } = await load();
    const out = await cloud.submitTemplates(gymA, [t("a"), t("b"), t("c")]);
    expect(out).toEqual([
      { key: "a", name: "fitron_a", ok: true },
      { key: "b", name: "fitron_b", ok: false, error: "Content violates policy" },
      { key: "c", name: "fitron_c", ok: true, error: undefined },
    ]);
    expect(calls[0]).toMatchObject({ url: expect.stringContaining("/900001/message_templates"), auth: "Bearer TOKEN-A" });
    expect((calls[0]!.body as { components: { type: string; example?: unknown }[] }).components).toEqual([{ type: "BODY", text: "Hi {{1}}.", example: { body_text: [["Rahul"]] } }]);
  });
});
