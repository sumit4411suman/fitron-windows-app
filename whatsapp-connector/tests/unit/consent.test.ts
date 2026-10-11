import { describe, expect, it } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/index.js";
import { ConsentService, matchesKeyword } from "../../src/services/ConsentService.js";
import { FakeDb } from "../helpers/fakeDb.js";

const make = (policy = { allowTransactionalAfterOptOut: false, requireOptInForTransactional: false }) => new ConsentService(new FakeDb() as unknown as PrismaClient, policy);

describe("ConsentService", () => {
  it("marketing needs an opt-in; transactional does not, until an opt-out", async () => {
    const s = make();
    await expect(s.assertAllowed("g", "919876543210", "MARKETING")).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    await expect(s.assertAllowed("g", "919876543210", "TRANSACTIONAL")).resolves.toBeUndefined();
    await s.optIn("g", "919876543210", "signup", "MEM1");
    await expect(s.assertAllowed("g", "919876543210", "MARKETING")).resolves.toBeUndefined();
    const out = await s.optOut("g", "919876543210", "keyword");
    expect(out.whatsappOptIn).toBe(false);
    expect(out.optOutAt).toBeInstanceOf(Date);
    expect(out.memberId).toBe("MEM1");
    await expect(s.assertAllowed("g", "919876543210", "MARKETING")).rejects.toMatchObject({ code: "OPTED_OUT" });
    await expect(s.assertAllowed("g", "919876543210", "TRANSACTIONAL")).rejects.toMatchObject({ code: "OPTED_OUT" });
    // opting back in clears the opt-out
    await s.optIn("g", "919876543210", "keyword");
    await expect(s.assertAllowed("g", "919876543210", "TRANSACTIONAL")).resolves.toBeUndefined();
  });

  it("is scoped per gym", async () => {
    const s = make();
    await s.optOut("A", "919876543210", "api");
    await expect(s.assertAllowed("B", "919876543210", "TRANSACTIONAL")).resolves.toBeUndefined();
    expect(await s.get("B", "919876543210")).toBeNull();
  });

  it("honours the operator's policy switches", async () => {
    const lenient = make({ allowTransactionalAfterOptOut: true, requireOptInForTransactional: false });
    await lenient.optOut("g", "1", "api");
    await expect(lenient.assertAllowed("g", "1", "TRANSACTIONAL")).resolves.toBeUndefined();
    await expect(lenient.assertAllowed("g", "1", "MARKETING")).rejects.toMatchObject({ code: "OPTED_OUT" });
    const strict = make({ allowTransactionalAfterOptOut: false, requireOptInForTransactional: true });
    await expect(strict.assertAllowed("g", "2", "TRANSACTIONAL")).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
  });
});

describe("matchesKeyword", () => {
  const kw = ["STOP", "UNSUBSCRIBE", "CANCEL", "OPT OUT"];
  it.each(["STOP", "stop", " Stop. ", "unsubscribe!", "opt   out", "CANCEL"])("matches %s", (t) => expect(matchesKeyword(t, kw)).toBe(true));
  it.each(["please stop sending", "stopping by today", "ok", "", "cancel my 6am class"])("ignores %s", (t) => expect(matchesKeyword(t, kw)).toBe(false));
});
