import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { isLocal } from "@/lib/runtime/edition";
import type { AddressInfo } from "node:net";

// A stand-in for whatsapp-connector/: the same routes and answers, with gyms, keys and a per-gym session state in memory.
// The sealed key store is replaced by a map so no database is needed.
const store = new Map<string, { gymId: string; apiKey: string }>();
// Where the connector is as FITRON for Windows keeps it (entered in Settings › WhatsApp); fitron.in reads its environment.
let site: { url: string; key: string } | null = null;
vi.mock("@/lib/services/wa-connector-store", () => ({
  getConnectorSite: async () => site,
  getConnectorGym: async (orgId: string) => store.get(orgId) ?? null,
  saveConnectorGym: async (orgId: string, g: { gymId: string; apiKey: string }) => void store.set(orgId, g),
  removeConnectorGym: async (orgId: string) => void store.delete(orgId),
}));

const MASTER = "master-key-for-tests";
type Gym = { gymId: string; externalId: string; name: string; apiKey: string };
let server: Server;
let port = 0;
let gyms: Gym[] = [];
let sessions: Record<string, { status: string; phone?: string; error?: string; qr?: string }> = {};
let workerRunning = true;
const sent: Record<string, unknown>[] = [];
const calls: { method: string; path: string; gymId?: string }[] = [];
let keySerial = 0;
const newKey = () => "wak_" + (keySerial++).toString(16).padStart(48, "0");

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const reply = (code: number, body: unknown) => {
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      };
      const err = (code: number, c: string, message: string) => reply(code, { success: false, error: { code: c, message } });
      const url = new URL(req.url ?? "/", "http://x");
      const key = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
      const raw = Buffer.concat(chunks).toString();
      const body = (req.headers["content-type"] ?? "").startsWith("application/json") && raw ? JSON.parse(raw) : {};
      const p = url.pathname;
      calls.push({ method: req.method ?? "", path: p });
      // admin
      if (p.startsWith("/api/v1/gyms")) {
        if (key !== MASTER) return err(401, "INVALID_API_KEY", "Invalid master key.");
        if (req.method === "POST" && p === "/api/v1/gyms") {
          if (gyms.some((g) => g.externalId === body.externalId)) return err(409, "DUPLICATE_REQUEST", "exists");
          const g = { gymId: `gym_${gyms.length + 1}`, externalId: body.externalId, name: body.name, apiKey: newKey() };
          gyms.push(g);
          return reply(201, { success: true, data: g });
        }
        const ext = /^\/api\/v1\/gyms\/by-external\/(.+)$/.exec(p);
        if (ext) {
          const g = gyms.find((x) => x.externalId === decodeURIComponent(ext[1]!));
          return g ? reply(200, { success: true, data: { gymId: g.gymId, name: g.name } }) : err(404, "GYM_NOT_FOUND", "no");
        }
        const rot = /^\/api\/v1\/gyms\/([^/]+)\/rotate-key$/.exec(p);
        if (rot) {
          const g = gyms.find((x) => x.gymId === rot[1]);
          if (!g) return err(404, "GYM_NOT_FOUND", "no");
          g.apiKey = newKey();
          return reply(200, { success: true, data: { gymId: g.gymId, apiKey: g.apiKey } });
        }
        return err(404, "NOT_FOUND", "no");
      }
      // gym endpoints
      const gym = gyms.find((g) => g.apiKey === key);
      if (!gym) return err(401, "INVALID_API_KEY", "Invalid API key.");
      calls[calls.length - 1]!.gymId = gym.gymId;
      const s = (sessions[gym.gymId] ??= { status: "DISCONNECTED" });
      if (p === "/api/v1/whatsapp/status") return reply(200, { success: true, connected: s.status === "CONNECTED", status: s.status, phone: s.phone ?? null, data: { status: s.status, phone: s.phone ?? null, error: s.error ?? null, workerRunning, today: { sent: 3, failed: 0 }, queued: 2, limits: { perDay: 500 } } });
      if (p === "/api/v1/whatsapp/qr") return s.qr ? reply(200, { success: true, data: { status: s.status, qr: s.qr } }) : err(410, "QR_EXPIRED", "none yet");
      if (p === "/api/v1/whatsapp/connect") {
        if (!workerRunning) return err(503, "SERVICE_UNAVAILABLE", "worker down");
        s.status = "QR_REQUIRED";
        return reply(200, { success: true, status: "QR_REQUIRED", data: { status: "QR_REQUIRED" } });
      }
      if (p === "/api/v1/whatsapp/disconnect") {
        sessions[gym.gymId] = { status: "DISCONNECTED" };
        return reply(200, { success: true, data: { status: "DISCONNECTED", loggedOut: true } });
      }
      if (p === "/api/v1/messages/send") {
        if (s.status !== "CONNECTED") return err(409, "WHATSAPP_NOT_CONNECTED", "WhatsApp is not connected.");
        sent.push({ gymId: gym.gymId, ...body });
        return reply(202, { success: true, messageId: `wa_${sent.length}`, data: { messageId: `wa_${sent.length}`, status: "QUEUED", idempotencyKey: body.idempotencyKey } });
      }
      if (p === "/api/v1/messages/document") {
        sent.push({ gymId: gym.gymId, multipart: true, bytes: raw.length, hasPdf: raw.includes("application/pdf") && raw.includes('name="file"') });
        return reply(202, { success: true, messageId: `wa_${sent.length}`, data: { messageId: `wa_${sent.length}`, status: "QUEUED" } });
      }
      if (p === "/api/v1/messages") {
        const keys = (url.searchParams.get("idempotencyKeys") ?? "").split(",");
        const items = [
          { messageId: "wa_1", idempotencyKey: "m1", status: "DELIVERED", error: null },
          { messageId: "wa_2", idempotencyKey: "m2", status: "FAILED", error: "Number is not on WhatsApp" },
          { messageId: "wa_3", idempotencyKey: "m3", status: "PROCESSING", error: null },
        ].filter((m) => keys.includes(m.idempotencyKey));
        return reply(200, { success: true, data: { items, nextCursor: null } });
      }
      err(404, "NOT_FOUND", "no");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  gyms = [];
  sessions = {};
  store.clear();
  site = null;
  sent.length = 0;
  calls.length = 0;
  workerRunning = true;
});

const load = () => import(".");
/** Points both editions at a connector: the server's settings (fitron.in) and the gym's saved address (Windows). */
const setBoth = (url: string, key: string) => {
  vi.stubEnv("WA_CONNECTOR_URL", url);
  vi.stubEnv("WA_CONNECTOR_KEY", key);
  site = url && key ? { url, key } : null;
};
const configure = (key = MASTER) => setBoth(`http://127.0.0.1:${port}/`, key);

describe("self-hosted WhatsApp connector", () => {
  it("needs both an address and a key before a gym can link", async () => {
    setBoth("", "");
    const wa = await load();
    // FITRON for Windows with no connector entered links the phone itself (embedded.ts); half a connector is refused,
    // saying what to do there instead of naming server settings.
    const notSetUp = isLocal() ? wa.LOCAL_NEEDS_CONNECTOR : wa.HOSTED_NEEDS_CONNECTOR;
    expect(await wa.connectorReady("org_a")).toBe(isLocal() ? null : wa.HOSTED_NEEDS_CONNECTOR);
    expect(wa.builtInLink(await wa.connectorSite("org_a"))).toBe(isLocal());
    expect(wa.HOSTED_NEEDS_CONNECTOR).toMatch(/WA_CONNECTOR_URL/);
    expect(wa.LOCAL_NEEDS_CONNECTOR).not.toMatch(/WA_CONNECTOR/);
    expect(wa.LOCAL_NEEDS_CONNECTOR).toMatch(/Settings › WhatsApp/);
    setBoth("https://wa-api.fitron.in", "");
    expect(await wa.connectorReady("org_a")).toBe(notSetUp);
    setBoth("https://wa-api.fitron.in", "x");
    expect(await wa.connectorReady("org_a")).toBeNull();
    expect(wa.connectorAddress(await wa.connectorSite("org_a"))).toBe("https://wa-api.fitron.in");
  });

  it("FITRON for Windows reads only the gym's saved address, never the server's settings; fitron.in the other way round", async () => {
    const wa = await load();
    vi.stubEnv("WA_CONNECTOR_URL", "https://from-the-environment.example");
    vi.stubEnv("WA_CONNECTOR_KEY", "env-key");
    site = { url: "http://192.168.1.20:3000/", key: "saved-key" };
    expect(await wa.connectorSite("org_a")).toEqual(isLocal() ? { url: "http://192.168.1.20:3000", key: "saved-key" } : { url: "https://from-the-environment.example", key: "env-key" });
  });

  it("rejects an address that is not http(s)", async () => {
    setBoth("wa-api.fitron.in", "x");
    expect(await (await load()).connectorReady("org_a")).toMatch(/http/);
  });

  it("creates the gym on the connector the first time, keeps its key, and never uses the master key for the gym's calls", async () => {
    configure();
    const wa = await load();
    expect(await wa.connectorStatus("org_a", { gymName: "Iron Gym" })).toMatchObject({ state: "disconnected" });
    expect(gyms).toEqual([expect.objectContaining({ externalId: "org_a", name: "Iron Gym" })]);
    expect(store.get("org_a")).toEqual({ gymId: "gym_1", apiKey: gyms[0]!.apiKey });
    const adminCalls = calls.filter((c) => c.path.startsWith("/api/v1/gyms")).length;
    await wa.connectorStatus("org_a");
    expect(calls.filter((c) => c.path.startsWith("/api/v1/gyms")).length).toBe(adminCalls); // provisioned once
    expect(calls.filter((c) => c.path === "/api/v1/whatsapp/status").every((c) => c.gymId === "gym_1")).toBe(true);
  });

  it("recovers a lost key by rotating it, and replaces a key the connector stopped accepting", async () => {
    configure();
    const wa = await load();
    await wa.connectorStatus("org_a");
    const first = store.get("org_a")!.apiKey;
    store.clear(); // Fitron forgot the key (restored elsewhere): no second gym is created
    await wa.connectorStatus("org_a");
    expect(gyms).toHaveLength(1);
    expect(store.get("org_a")!.apiKey).not.toBe(first);
    // the connector rotated the key behind Fitron's back (operator action): one retry with a fresh key
    gyms[0]!.apiKey = newKey();
    expect(await wa.connectorStatus("org_a")).toMatchObject({ state: "disconnected" });
    expect(store.get("org_a")!.apiKey).toBe(gyms[0]!.apiKey);
  });

  it("is ready to send only when the gym's WhatsApp is linked, and says why not otherwise", async () => {
    configure();
    const wa = await load();
    await wa.connectorStatus("org_a");
    expect(await wa.connectorAnswers("org_a")).toMatch(/^WhatsApp on the linked phone is not ready \(disconnected\)/);
    sessions.gym_1 = { status: "QR_REQUIRED", qr: "data:image/png;base64,AAAA" };
    expect(await wa.connectorAnswers("org_a")).toMatch(/^WhatsApp on the linked phone is not ready \(qr\)/);
    sessions.gym_1 = { status: "SESSION_EXPIRED", error: "WhatsApp signed this device out." };
    expect(await wa.connectorAnswers("org_a")).toBe("The connector is running but WhatsApp has not started: WhatsApp signed this device out.");
    sessions.gym_1 = { status: "CONNECTED", phone: "+919876543210" };
    expect(await wa.connectorAnswers("org_a")).toBeNull();
  });

  it("the Link dialog asks the connector to connect, then shows the QR, then the linked number", async () => {
    configure();
    const wa = await load();
    expect(await wa.connectorStatus("org_a", { start: true })).toMatchObject({ state: "starting", error: null });
    expect(sessions.gym_1!.status).toBe("QR_REQUIRED");
    sessions.gym_1!.qr = "data:image/png;base64,AAAA";
    expect(await wa.connectorStatus("org_a", { start: true })).toMatchObject({ state: "qr", qr: "data:image/png;base64,AAAA" });
    sessions.gym_1 = { status: "CONNECTED", phone: "+919876543210" };
    expect(await wa.connectorStatus("org_a", { start: true })).toMatchObject({ state: "ready", number: "919876543210", sentToday: 3, cap: 500, queued: 2 });
    expect(await wa.providerStatus("connector", "org_a")).toMatchObject({ ok: true, text: expect.stringContaining("+919876543210"), number: "919876543210" });
    // reading the status (Settings page) never starts a session by itself
    sessions.gym_1 = { status: "DISCONNECTED" };
    expect(await wa.connectorStatus("org_a")).toMatchObject({ state: "disconnected" });
    expect(sessions.gym_1!.status).toBe("DISCONNECTED");
  });

  it("passes on why linking cannot start, and reconnecting state", async () => {
    configure();
    const wa = await load();
    workerRunning = false;
    const st = await wa.connectorStatus("org_a", { start: true });
    expect(st.state).toBe("starting");
    expect(st.error).toMatch(/worker is not running/);
    workerRunning = true;
    sessions.gym_1 = { status: "SESSION_EXPIRED", error: "WhatsApp signed this device out." };
    expect(await wa.providerStatus("connector", "org_a")).toMatchObject({ ok: false, text: expect.stringContaining("signed this device out") });
    sessions.gym_1 = { status: "RECONNECTING" };
    expect(await wa.providerStatus("connector", "org_a")).toMatchObject({ ok: false, text: expect.stringMatching(/reconnecting/i) });
  });

  it("says the master key is wrong instead of failing silently", async () => {
    configure("not-the-key");
    const wa = await load();
    const st = await wa.providerStatus("connector", "org_a");
    expect(st.ok).toBe(false);
    // Where the key is set: the server's WA_CONNECTOR_KEY on fitron.in, the Connector panel on Windows.
    const where = isLocal() ? /Connector in Settings › WhatsApp/ : /WA_CONNECTOR_KEY/;
    expect(st.text).toMatch(where);
    const r = await wa.sendWhatsApp("connector", { orgId: "org_a", localId: "x", to: "919876543210", body: "hi" });
    expect(r).toMatchObject({ status: "Failed", error: expect.stringMatching(where) });
  });

  it("says the connector is not running when nothing answers", async () => {
    setBoth("http://127.0.0.1:1", MASTER);
    const wa = await load();
    const st = await wa.providerStatus("connector", "org_a");
    expect(st).toMatchObject({ ok: false, text: expect.stringContaining("Nothing is answering at http://127.0.0.1:1") });
    expect(await wa.sendWhatsApp("connector", { orgId: "org_a", localId: "x", to: "9", body: "hi" })).toMatchObject({ status: "Failed", error: expect.stringContaining("Nothing is answering") });
    expect(await wa.connectorResults("org_a", ["m1"])).toBeNull();
  });

  it("queues a message with Fitron's id as the idempotency key, sends PDFs as multipart, and reads statuses back", async () => {
    configure();
    const wa = await load();
    await wa.connectorStatus("org_a");
    sessions.gym_1 = { status: "CONNECTED", phone: "+919876543210" };
    expect(await wa.sendWhatsApp("connector", { orgId: "org_a", localId: "m1", to: "919876543210", body: "Hello" })).toEqual({ status: "Queued", providerMessageId: "wa_1" });
    expect(sent[0]).toEqual({ gymId: "gym_1", to: "919876543210", message: "Hello", idempotencyKey: "m1", category: "TRANSACTIONAL" });
    expect(await wa.sendWhatsApp("connector", { orgId: "org_a", localId: "m2", to: "919876543210", body: "Invoice", pdf: { bytes: new TextEncoder().encode("%PDF-1.4"), filename: "INV-1.pdf" } })).toEqual({ status: "Queued", providerMessageId: "wa_2" });
    expect(sent[1]).toMatchObject({ gymId: "gym_1", multipart: true, hasPdf: true });
    expect(await wa.connectorResults("org_a", ["m1", "m2", "m3", "m9"])).toEqual({ m1: { status: "Delivered", error: undefined }, m2: { status: "Failed", error: "Number is not on WhatsApp" }, m3: { status: "Queued", error: undefined } });
  });

  it("reports the connector's own reason when a send is refused", async () => {
    configure();
    const wa = await load();
    await wa.connectorStatus("org_a");
    const r = await wa.sendWhatsApp("connector", { orgId: "org_a", localId: "m1", to: "919876543210", body: "Hello" });
    expect(r).toEqual({ status: "Failed", error: "WhatsApp is not connected." });
  });

  it("each gym gets its own connector gym and key, so one gym's WhatsApp is never another's", async () => {
    configure();
    const wa = await load();
    await wa.connectorStatus("org_b");
    await wa.connectorStatus("org_c");
    sessions.gym_1 = { status: "CONNECTED", phone: "+911111111111" };
    sessions.gym_2 = { status: "CONNECTED", phone: "+912222222222" };
    await wa.sendWhatsApp("connector", { orgId: "org_b", localId: "m3", to: "919876543210", body: "Hi" });
    await wa.sendWhatsApp("connector", { orgId: "org_c", localId: "m4", to: "919876543210", body: "Hi" });
    expect(gyms.map((g) => g.externalId)).toEqual(["org_b", "org_c"]);
    expect(store.get("org_b")!.apiKey).not.toBe(store.get("org_c")!.apiKey);
    expect(sent.map((s) => s.gymId)).toEqual(["gym_1", "gym_2"]);
    expect((await wa.connectorStatus("org_c")).number).toBe("912222222222");
    await wa.connectorLogout("org_b");
    expect(sessions.gym_1!.status).toBe("DISCONNECTED");
    expect(sessions.gym_2!.status).toBe("CONNECTED");
  });
});
