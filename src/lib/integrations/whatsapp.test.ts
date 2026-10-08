import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// A stand-in for prototype/connector/server.js: same routes, same key check.
let server: Server;
let port = 0;
let state: Record<string, unknown> = { state: "qr" };
const sent: { id: string; to: string; text: string }[] = [];
const orgs = new Set<string>();
const KEY = "fitron-local";

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const reply = (code: number, body: unknown) => {
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.headers["x-fitron-key"] !== KEY) return reply(401, { error: "Wrong connector key" });
      orgs.add(String(req.headers["x-fitron-org"]));
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      if (req.url === "/status") return reply(200, state);
      if (req.url === "/qr") return reply(200, { state: state.state, qr: state.state === "qr" ? "data:image/png;base64,AAAA" : null });
      if (req.url === "/send") {
        sent.push(body);
        return reply(200, { id: body.id, status: "Queued" });
      }
      if (req.url === "/results") return reply(200, Object.fromEntries((body.ids as string[]).filter((i) => i === "m1").map((i) => [i, { status: "Delivered" }])));
      reply(404, { error: "no" });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  state = { state: "qr" };
  sent.length = 0;
  orgs.clear();
});

const load = () => import("./whatsapp");

describe("linked-phone connector", () => {
  it("is ready without any environment settings: the app looks on this computer with the built-in key", async () => {
    vi.stubEnv("WA_CONNECTOR_URL", "");
    vi.stubEnv("WA_CONNECTOR_KEY", "");
    const wa = await load();
    expect(wa.providerReady("connector")).toBeNull();
    expect(wa.connectorAddress()).toBe("http://127.0.0.1:3131");
  });

  it("on Vercel, without a hosted connector, says what to set up instead of looking at 127.0.0.1", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("WA_CONNECTOR_URL", "");
    const wa = await load();
    expect(wa.providerReady("connector")).toBe(wa.HOSTED_NEEDS_CONNECTOR);
    vi.stubEnv("WA_CONNECTOR_URL", "https://fitron-whatsapp.onrender.com");
    expect((await load()).providerReady("connector")).toBeNull();
  });

  it("rejects an address that is not http(s)", async () => {
    vi.stubEnv("WA_CONNECTOR_URL", "localhost:3131");
    expect((await load()).providerReady("connector")).toMatch(/http/);
  });

  it("reports the QR code, then the linked number", async () => {
    vi.stubEnv("WA_CONNECTOR_URL", `http://127.0.0.1:${port}/`);
    vi.stubEnv("WA_CONNECTOR_KEY", KEY);
    const wa = await load();
    expect(await wa.connectorStatus("gymA")).toMatchObject({ state: "qr", qr: "data:image/png;base64,AAAA" });
    state = { state: "ready", number: "919876543210", sentToday: 3, cap: 250 };
    expect(await wa.providerStatus("connector", "gymA")).toMatchObject({ ok: true, text: expect.stringContaining("919876543210") });
  });

  it("passes on why WhatsApp itself did not start", async () => {
    vi.stubEnv("WA_CONNECTOR_URL", `http://127.0.0.1:${port}`);
    vi.stubEnv("WA_CONNECTOR_KEY", KEY);
    state = { state: "error", error: "This computer cannot reach web.whatsapp.com." };
    const wa = await load();
    const st = await wa.providerStatus("connector", "gymA");
    expect(st.ok).toBe(false);
    expect(st.text).toContain("web.whatsapp.com");
  });

  it("says the key is wrong instead of failing silently", async () => {
    vi.stubEnv("WA_CONNECTOR_URL", `http://127.0.0.1:${port}`);
    vi.stubEnv("WA_CONNECTOR_KEY", "not-the-key");
    const wa = await load();
    const st = await wa.providerStatus("connector", "gymA");
    expect(st.ok).toBe(false);
    expect(st.text).toMatch(/key/i);
    const r = await wa.sendWhatsApp("connector", { orgId: "gymA", localId: "x", to: "919876543210", body: "hi" });
    expect(r).toMatchObject({ status: "Failed", error: expect.stringMatching(/key/i) });
  });

  it("says the connector is not running when nothing answers", async () => {
    vi.stubEnv("WA_CONNECTOR_URL", "http://127.0.0.1:1");
    vi.stubEnv("WA_CONNECTOR_KEY", KEY);
    const wa = await load();
    const st = await wa.providerStatus("connector", "gymA");
    expect(st).toMatchObject({ ok: false, text: expect.stringContaining("Nothing is answering at http://127.0.0.1:1") });
    expect(await wa.sendWhatsApp("connector", { orgId: "gymA", localId: "x", to: "9", body: "hi" })).toMatchObject({ status: "Failed", error: expect.stringContaining("Nothing is answering") });
    expect(await wa.connectorResults("gymA", ["m1"])).toBeNull();
  });

  it("queues a message and reads its delivery status back", async () => {
    vi.stubEnv("WA_CONNECTOR_URL", `http://127.0.0.1:${port}`);
    vi.stubEnv("WA_CONNECTOR_KEY", KEY);
    const wa = await load();
    expect(await wa.sendWhatsApp("connector", { orgId: "gymA", localId: "m1", to: "919876543210", body: "Hello" })).toEqual({ status: "Queued", providerMessageId: "m1" });
    expect(sent).toEqual([expect.objectContaining({ id: "m1", to: "919876543210", text: "Hello" })]);
    expect(await wa.connectorResults("gymA", ["m1", "m2"])).toEqual({ m1: { status: "Delivered" } });
  });

  it("tells the connector which gym every call is for, so each gym has its own WhatsApp", async () => {
    vi.stubEnv("WA_CONNECTOR_URL", `http://127.0.0.1:${port}`);
    vi.stubEnv("WA_CONNECTOR_KEY", KEY);
    const wa = await load();
    await wa.sendWhatsApp("connector", { orgId: "gymB", localId: "m3", to: "919876543210", body: "Hi" });
    await wa.connectorStatus("gymC");
    await wa.connectorResults("gymD", ["m3"]);
    expect([...orgs].sort()).toEqual(["gymB", "gymC", "gymD"]);
  });
});
