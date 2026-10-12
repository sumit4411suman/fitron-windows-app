import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { hasDb } from "@/test/db";
import { isLocal } from "@/lib/runtime/edition";
import { newSigningKey, signLicence } from "@/lib/licence/issue";
import type { Licence } from "@/lib/licence/licence";
import { addDays } from "@/lib/domain/dates";
import { todayIso } from "./time";

// fitron.in answering Fitron AI for FITRON for Windows computers (src/lib/services/windows-ai.ts).
const keys = vi.hoisted(() => ({ list: [] as { id: string; publicKey: string }[] }));
vi.mock("@/lib/licence/keys", () => ({ get FITRON_LICENCE_KEYS() { return keys.list; } }));
const anthropic = vi.hoisted(() => vi.fn());
vi.mock("@/lib/integrations/ai", () => ({ anthropicMessages: anthropic }));

const { relayBody, relayWindowsAi } = await import("./windows-ai");

describe.skipIf(!hasDb || isLocal())("Fitron AI for FITRON for Windows, through fitron.in (database)", () => {
  const signing = newSigningKey("fitron-online-test");
  const today = todayIso();
  const licence = (over: Partial<Licence> = {}) =>
    signLicence({ v: 1, licenceId: `FITW-T-${randomUUID().slice(0, 8)}`, keyId: signing.trusted.id, licensee: "Iron Gym", plan: "professional", edition: "local", branches: 1, installationId: "inst-12345678", issuedOn: today, expiresOn: addDays(today, 30), graceDays: 15, ...over }, signing.privatePem);
  const ask = { system: "You are Fitron AI.", messages: [{ role: "user", content: "Dues this month?" }], tools: [], max_tokens: 50_000 };

  beforeEach(() => {
    keys.list = [signing.trusted];
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    vi.stubEnv("WINDOWS_AI_DAILY_LIMIT", "2");
    anthropic.mockReset().mockResolvedValue({ content: [{ type: "text", text: "₹12,000 due." }], stop_reason: "end_turn", usage: { input_tokens: 900, output_tokens: 40 } });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("answers for a current licence with FITRON's key, capped, and counts the day's use", async () => {
    const text = licence();
    const out = await relayWindowsAi(text, ask);
    expect(out).toEqual({ ok: true, reply: { content: [{ type: "text", text: "₹12,000 due." }], stop_reason: "end_turn" } });
    expect(anthropic).toHaveBeenCalledWith(expect.objectContaining({ system: "You are Fitron AI.", maxTokens: 4096 }));
    const id = JSON.parse(Buffer.from(text.split(".")[1]!, "base64url").toString()).licenceId;
    expect(await db.windowsAiUsage.findUniqueOrThrow({ where: { licenceId_day: { licenceId: id, day: today } } })).toMatchObject({ requests: 1, inputTokens: 900, outputTokens: 40 });
  });

  it("keeps to the daily allowance", async () => {
    const text = licence();
    expect((await relayWindowsAi(text, ask)).ok).toBe(true);
    expect((await relayWindowsAi(text, ask)).ok).toBe(true);
    expect(await relayWindowsAi(text, ask)).toMatchObject({ ok: false, status: 429 });
    expect(anthropic).toHaveBeenCalledTimes(2);
  });

  it("refuses without a licence, a forged or ended one, or one not tied to a computer", async () => {
    expect(await relayWindowsAi(null, ask)).toMatchObject({ ok: false, status: 401 });
    const other = newSigningKey("someone-else");
    const forged = signLicence({ v: 1, licenceId: "FAKE", keyId: signing.trusted.id, licensee: "X", plan: "enterprise", edition: "local", branches: 3, installationId: "inst-12345678", issuedOn: today, expiresOn: addDays(today, 365), graceDays: 15 }, other.privatePem);
    expect(await relayWindowsAi(forged, ask)).toMatchObject({ ok: false, status: 403 });
    expect(await relayWindowsAi(licence({ expiresOn: addDays(today, -20), graceDays: 15 }), ask)).toMatchObject({ ok: false, status: 403 });
    expect((await relayWindowsAi(licence({ expiresOn: addDays(today, -10), graceDays: 15 }), ask)).ok).toBe(true);
    expect(await relayWindowsAi(licence({ installationId: undefined }), ask)).toMatchObject({ ok: false, status: 403 });
    expect(anthropic).toHaveBeenCalledTimes(1);
  });

  it("says when fitron.in has no key of its own, and refuses a request that is not Claude's shape", async () => {
    expect(await relayWindowsAi(licence(), { messages: [] })).toMatchObject({ ok: false, status: 400 });
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(await relayWindowsAi(licence(), ask)).toMatchObject({ ok: false, status: 503 });
    expect(relayBody({ system: "s", messages: [{}], max_tokens: 100 })).toEqual({ system: "s", messages: [{}], tools: [], maxTokens: 100 });
    expect(relayBody({ system: 1, messages: [{}] })).toBeNull();
  });
});
