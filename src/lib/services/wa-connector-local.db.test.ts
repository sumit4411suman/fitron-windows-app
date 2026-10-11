import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { isLocal } from "@/lib/runtime/edition";
import { makeGym, pick } from "@/test/db";
import { LOCAL_ONLY_SETTINGS } from "@/lib/sync/entities";
import { connectorReady, connectorSite, LOCAL_NEEDS_CONNECTOR, sendWhatsApp } from "@/lib/integrations/whatsapp";
import { forgetConnectorAddress, saveConnectorAddress } from "./whatsapp";
import { CONNECTOR_KEY, getConnectorGym, removeConnectorGym, saveConnectorGym } from "./wa-connector-store";

// FITRON for Windows, Settings › WhatsApp › Connector: the gym says where its WhatsApp connector runs. The key is sealed
// here, never shown or synced, and messages then go to that address.

const MASTER = "a-master-key-for-the-connector-0001";

describe.skipIf(!isLocal())("the WhatsApp connector's address on FITRON for Windows (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let admin: Awaited<ReturnType<typeof gym.user>>;
  let server: Server;
  let port = 0;
  const seen: { method: string; url: string; auth: string }[] = [];

  beforeAll(async () => {
    gym = await makeGym();
    admin = pick(await gym.user("Super Admin"), gym.a.id);
    // A stand-in for whatsapp-connector/: creates the gym with the master key, then takes messages with the gym's key.
    server = createServer((req, res) => {
      seen.push({ method: req.method!, url: req.url!, auth: req.headers.authorization ?? "" });
      const send = (status: number, body: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
      req.resume();
      req.on("end", () => {
        if (req.url!.startsWith("/api/v1/gyms/by-external/")) return send(404, { success: false, error: { code: "NOT_FOUND", message: "No gym" } });
        if (req.url === "/api/v1/gyms" && req.headers.authorization === `Bearer ${MASTER}`) return send(200, { success: true, data: { gymId: "g1", apiKey: "gym-key-1" } });
        if (req.url === "/api/v1/messages/send" && req.headers.authorization === "Bearer gym-key-1") return send(200, { success: true, data: { messageId: "m1", status: "QUEUED", idempotencyKey: "local-1", error: null } });
        send(401, { success: false, error: { code: "INVALID_API_KEY", message: "Bad key" } });
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("says what to do until an address is entered", async () => {
    expect(await connectorReady(gym.org.id)).toBe(LOCAL_NEEDS_CONNECTOR);
  });

  it("refuses an address it cannot use, and a missing or implausible key", async () => {
    await expect(saveConnectorAddress(admin, { url: "wa.example.in", key: MASTER })).rejects.toThrow(/address/);
    await expect(saveConnectorAddress(admin, { url: "ftp://192.168.1.20", key: MASTER })).rejects.toThrow(/http/);
    await expect(saveConnectorAddress(admin, { url: "http://user:pw@192.168.1.20:3000", key: MASTER })).rejects.toThrow(/without a name/);
    await expect(saveConnectorAddress(admin, { url: "http://192.168.1.20:3000", key: "" })).rejects.toThrow(/key/);
    await expect(saveConnectorAddress(admin, { url: "http://192.168.1.20:3000", key: "short" })).rejects.toThrow(/16 or more/);
    expect(await db.setting.count({ where: { orgId: gym.org.id, key: CONNECTOR_KEY } })).toBe(0);
  });

  it("keeps the key sealed, never in the audit log, and the setting never syncs", async () => {
    expect(await saveConnectorAddress(admin, { url: `http://127.0.0.1:${port}/`, key: MASTER })).toBe(`http://127.0.0.1:${port}`);
    expect(await connectorSite(gym.org.id)).toEqual({ url: `http://127.0.0.1:${port}`, key: MASTER });
    expect(await connectorReady(gym.org.id)).toBeNull();
    const row = await db.setting.findUniqueOrThrow({ where: { orgId_key: { orgId: gym.org.id, key: CONNECTOR_KEY } } });
    expect(JSON.stringify(row.value)).not.toContain(MASTER);
    const entry = await db.auditLog.findFirstOrThrow({ where: { orgId: gym.org.id, action: "whatsapp.connector" }, orderBy: { id: "desc" } });
    expect(JSON.stringify({ before: entry.before, after: entry.after })).not.toContain(MASTER);
    expect(LOCAL_ONLY_SETTINGS).toContain(CONNECTOR_KEY);
  });

  it("sends to the entered address: the master key only creates the gym there, its own key sends", async () => {
    const r = await sendWhatsApp("connector", { orgId: gym.org.id, localId: "local-1", to: "919876500001", body: "Hello" });
    expect(r).toMatchObject({ status: "Queued", providerMessageId: "m1" });
    expect(seen.find((c) => c.url === "/api/v1/gyms")?.auth).toBe(`Bearer ${MASTER}`);
    expect(seen.find((c) => c.url === "/api/v1/messages/send")?.auth).toBe("Bearer gym-key-1");
    expect(await getConnectorGym(gym.org.id)).toEqual({ gymId: "g1", apiKey: "gym-key-1" });
  });

  it("a blank key keeps the saved one; the gym's key survives a rotation but not a new address", async () => {
    await saveConnectorAddress(admin, { url: `http://127.0.0.1:${port}`, key: "" });
    expect((await connectorSite(gym.org.id)).key).toBe(MASTER);
    expect(await getConnectorGym(gym.org.id)).not.toBeNull();
    // A key the connector stopped accepting is dropped; where the connector is stays.
    await removeConnectorGym(gym.org.id);
    expect(await getConnectorGym(gym.org.id)).toBeNull();
    expect((await connectorSite(gym.org.id)).url).toBe(`http://127.0.0.1:${port}`);
    await saveConnectorGym(gym.org.id, { gymId: "g1", apiKey: "gym-key-1" });
    // Another connector knows the gym under another key.
    await saveConnectorAddress(admin, { url: "https://wa.mygym.in", key: MASTER });
    expect(await getConnectorGym(gym.org.id)).toBeNull();
  });

  it("Forget it: back to saving messages, and nothing is left of the key", async () => {
    await forgetConnectorAddress(admin);
    expect(await connectorReady(gym.org.id)).toBe(LOCAL_NEEDS_CONNECTOR);
    expect(await db.setting.count({ where: { orgId: gym.org.id, key: CONNECTOR_KEY } })).toBe(0);
  });
});
