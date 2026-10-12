import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasDb, makeGym } from "@/test/db";
import { isLocal } from "@/lib/runtime/edition";
import { newSigningKey, signLicence } from "@/lib/licence/issue";
import type { Licence } from "@/lib/licence/licence";
import { planHas } from "@/lib/domain/features";
import { gymPlan } from "./saas";

// FITRON for Windows with a bought licence: the licence's plan sets the member cap and features, as on fitron.in.
const signing = vi.hoisted(() => ({ key: null as null | { id: string; publicKey: string } }));
vi.mock("@/lib/licence/keys", () => ({ get FITRON_LICENCE_KEYS() { return signing.key ? [signing.key] : []; } }));

let root = "";
const key = newSigningKey("fitron-online-test");
const today = new Date().toISOString().slice(0, 10);
const licensed = (plan: string, over: Partial<Licence> = {}) =>
  writeFileSync(
    path.join(root, "licence.fitronlicence"),
    signLicence({ v: 1, licenceId: "FITW-TEST", keyId: key.trusted.id, licensee: "Iron Gym", plan, edition: "local", branches: plan === "enterprise" ? 3 : 1, installationId: "test-install", issuedOn: today, expiresOn: "2099-12-31", graceDays: 15, ...over }, key.privatePem),
  );

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "fitron-licence-plan-"));
  vi.stubEnv("FITRON_DATA_DIR", root);
  vi.stubEnv("FITRON_LOCAL_ALLOW_SIGNUP", "");
  writeFileSync(path.join(root, "secrets.json"), JSON.stringify({ installationId: "test-install", createdAt: new Date().toISOString() }));
  signing.key = key.trusted;
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!hasDb || !isLocal())("a bought licence's plan on FITRON for Windows (database)", () => {
  it("opens everything during the trial", async () => {
    const g = await makeGym();
    const p = await gymPlan(g.org.id);
    expect(p.terms.custom).toBe(true);
  });

  it("gives Starter its member cap and features, Enterprise its branches and everything", async () => {
    const g = await makeGym();
    licensed("starter");
    const starter = await gymPlan(g.org.id);
    expect(starter).toMatchObject({ key: "starter", name: "Starter", terms: { custom: false, memberLimit: 100, includedBranches: 1, extraBranches: false } });
    expect(planHas({ key: starter.key, name: starter.name, custom: false }, "accounting")).toBe(planHas({ key: "starter", name: "Starter", custom: false }, "accounting"));

    licensed("enterprise");
    expect(await gymPlan(g.org.id)).toMatchObject({ key: "enterprise", terms: { memberLimit: null, includedBranches: 3 } });
  });

  it("keeps a licence for another computer from changing the plan", async () => {
    const g = await makeGym();
    licensed("starter", { installationId: "someone-else" });
    expect((await gymPlan(g.org.id)).terms.custom).toBe(true);
  });
});
