import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newSigningKey, signLicence } from "@/lib/licence/issue";
import { UserError } from "@/lib/services/errors";

// FITRON for Windows asking Claude through fitron.in with its licence (src/lib/integrations/ai).
const keys = vi.hoisted(() => ({ list: [] as { id: string; publicKey: string }[] }));
vi.mock("@/lib/licence/keys", () => ({ get FITRON_LICENCE_KEYS() { return keys.list; } }));

const { aiReady, aiService, claude } = await import(".");

const signing = newSigningKey("fitron-online-test");
const today = new Date().toISOString().slice(0, 10);
let root = "";
const licensed = () =>
  writeFileSync(
    path.join(root, "licence.fitronlicence"),
    signLicence({ v: 1, licenceId: "FITW-T", keyId: signing.trusted.id, licensee: "Iron Gym", plan: "professional", edition: "local", branches: 1, installationId: "inst-12345678", issuedOn: today, expiresOn: "2099-12-31", graceDays: 15 }, signing.privatePem),
  );

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "fitron-ai-relay-"));
  writeFileSync(path.join(root, "secrets.json"), JSON.stringify({ installationId: "inst-12345678", createdAt: new Date().toISOString() }));
  vi.stubEnv("FITRON_EDITION", "local");
  vi.stubEnv("FITRON_LOCAL_ALLOW_SIGNUP", "");
  vi.stubEnv("FITRON_DATA_DIR", root);
  vi.stubEnv("FITRON_SECRETS", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("FITRON_CLOUD_URL", "https://fitron.in");
  keys.list = [signing.trusted];
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
});

describe("Fitron AI on FITRON for Windows", () => {
  it("has no model during the trial: it answers from the books", () => {
    expect(aiReady()).toBe(false);
  });

  it("with a licence, asks Claude through fitron.in with the licence, never Anthropic directly", async () => {
    licensed();
    expect(aiReady()).toBe(true);
    expect(aiService()).toEqual({ host: "fitron.in", port: 443 });
    const fetch = vi.fn().mockResolvedValue(Response.json({ content: [{ type: "text", text: "Hi" }], stop_reason: "end_turn" }));
    vi.stubGlobal("fetch", fetch);
    const out = await claude({ system: "s", messages: [{ role: "user", content: "Dues?" }], tools: [] });
    expect(out.content).toEqual([{ type: "text", text: "Hi" }]);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://fitron.in/api/windows-ai/messages");
    expect(init.headers["x-fitron-licence"]).toMatch(/^FITRON-LICENCE-1\./);
    expect(init.headers["x-api-key"]).toBeUndefined();
    expect(JSON.parse(init.body)).toMatchObject({ system: "s", messages: [{ role: "user", content: "Dues?" }], max_tokens: 2048 });
  });

  it("says plainly why fitron.in did not answer", async () => {
    licensed();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "used up" }, { status: 429 })));
    const e = await claude({ system: "s", messages: [{ role: "user", content: "x" }], tools: [] }).catch((x) => x);
    expect(e).toBeInstanceOf(UserError);
    expect(e.message).toMatch(/a lot of questions for this gym today/);
  });

  it("uses the computer's own key when it has one (a FITRON test setup)", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-own");
    expect(aiReady()).toBe(true);
    expect(aiService()).toEqual({ host: "api.anthropic.com", port: 443 });
  });
});
