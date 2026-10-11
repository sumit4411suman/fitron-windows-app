import { afterEach, describe, expect, it, vi } from "vitest";

const net = vi.hoisted(() => ({ up: true }));
vi.mock("../online", async (importOriginal) => ({ ...(await importOriginal<typeof import("../online")>()), probablyOnline: vi.fn(async () => net.up) }));
const calls: { url: string; body: unknown }[] = [];
let answer: { status: number; json: unknown } | Error = { status: 200, json: { status: "active" } };
vi.stubGlobal(
  "fetch",
  vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (answer instanceof Error) throw answer;
    return new Response(JSON.stringify(answer.json), { status: answer.status });
  }),
);

import { askLicenceServer, LICENCE_FIELDS, licencePayload } from ".";

const ok = { licenceId: "FIT-ABC-123", installationId: "3f2c8d4e-1b2a-4c3d-9e8f-0a1b2c3d4e5f", edition: "local", plan: "professional", version: "1.0.0" };

afterEach(() => {
  vi.unstubAllEnvs();
  calls.length = 0;
  net.up = true;
  answer = { status: 200, json: { status: "active" } };
});

describe("the licence server sees the licence, never the gym's data", () => {
  it("sends only the licence fields", () => {
    expect(LICENCE_FIELDS).toEqual(["licenceId", "installationId", "edition", "plan", "version", "activation", "expiresOn"]);
    expect(licencePayload(ok)).toEqual(ok);
  });

  it("refuses anything else before a connection is opened", async () => {
    vi.stubEnv("FITRON_LICENCE_URL", "https://licence.example.com");
    for (const extra of [{ memberName: "Asha Verma" }, { gymName: "Iron Gym" }, { revenue: "150000" }, { gstin: "29ABCDE1234F1Z5" }]) {
      expect(() => licencePayload({ ...ok, ...extra })).toThrow(/^Not sent to the licence server/);
      await expect(askLicenceServer("check", { ...ok, ...extra })).rejects.toThrow(/^Not sent to the licence server/);
    }
    // A field that is allowed still carries only a short code: no names, sentences or numbers smuggled in.
    expect(() => licencePayload({ ...ok, plan: "Asha Verma 9876543210" })).toThrow("plan is not a short code");
    expect(() => licencePayload({ ...ok, expiresOn: "soon" })).toThrow("expiresOn is not a date");
    expect(calls).toEqual([]);
  });

  it("says it is not set up when there is no licence server, and asks nothing", async () => {
    expect(await askLicenceServer("check", ok)).toEqual({ ok: false, reason: "not-configured", message: "The licence server is not set up for this installation." });
    vi.stubEnv("FITRON_LICENCE_URL", "http://licence.example.com");
    expect((await askLicenceServer("check", ok)).ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("offline, says FITRON keeps working, without waiting on the server", async () => {
    vi.stubEnv("FITRON_LICENCE_URL", "https://licence.example.com/");
    net.up = false;
    const r = await askLicenceServer("check", ok);
    expect(r).toMatchObject({ ok: false, reason: "offline" });
    expect(!r.ok && r.message).toMatch(/^Checking the FITRON licence requires an internet connection\. FITRON keeps working with the licence it already has/);
    expect(calls).toEqual([]);
    // Online by the check, but the connection drops: the same answer, not an error page.
    net.up = true;
    answer = Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("connect ECONNRESET"), { code: "ECONNRESET" }) });
    expect(await askLicenceServer("check", ok)).toMatchObject({ ok: false, reason: "offline" });
  });

  it("posts the licence fields to the server, and passes on its answer or its refusal", async () => {
    vi.stubEnv("FITRON_LICENCE_URL", "https://licence.example.com/");
    expect(await askLicenceServer("check", ok)).toEqual({ ok: true, data: { status: "active" } });
    expect(calls).toEqual([{ url: "https://licence.example.com/v1/licences/check", body: ok }]);
    answer = { status: 403, json: { error: "This licence is in use on another computer." } };
    expect(await askLicenceServer("activate", ok)).toEqual({ ok: false, reason: "refused", message: "This licence is in use on another computer." });
  });
});
