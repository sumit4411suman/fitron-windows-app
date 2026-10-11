import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { newSigningKey, signLicence } from "./issue";
import { licenceStatus, licenceWritable, verifyLicence, type Licence } from "./licence";
import { importLicence, licenceFile, readLicence } from "./store";
import { FITRON_LICENCE_KEYS } from "./keys";

const fitron = newSigningKey("fitron-test");
const keys = [fitron.trusted];
const INSTALL = "3f2c8d4e-1b2a-4c3d-9e8f-0a1b2c3d4e5f";
const base: Licence = { v: 1, licenceId: "FIT-2026-00042", keyId: "fitron-test", licensee: "Iron Gym, Pune", plan: "professional", edition: "local", branches: 2, issuedOn: "2026-10-01", expiresOn: "2027-09-30", graceDays: 15 };
const issued = (over: Partial<Licence> = {}) => signLicence({ ...base, ...over }, fitron.privatePem);

describe("a FITRON licence file", () => {
  it("is accepted when FITRON signed it, and read back as written", () => {
    expect(verifyLicence(issued(), keys)).toEqual({ ok: true, licence: base });
  });

  it("is refused when anything was changed, signed by someone else, or is not a licence at all", () => {
    const [prefix, payload, sig] = issued().split(".");
    const edited = Buffer.from(JSON.stringify({ ...base, branches: 50, expiresOn: "2099-12-31" })).toString("base64url");
    expect(verifyLicence(`${prefix}.${edited}.${sig}`, keys)).toEqual({ ok: false, reason: "This licence was not signed by FITRON, or it was changed after signing." });
    const stranger = newSigningKey("fitron-test");
    expect(verifyLicence(signLicence(base, stranger.privatePem), keys).ok).toBe(false);
    expect(verifyLicence(issued({ keyId: "someone-else" }), keys)).toEqual({ ok: false, reason: "This licence was not signed by FITRON." });
    expect(verifyLicence("hello", keys)).toEqual({ ok: false, reason: "This is not a FITRON licence file." });
    expect(verifyLicence(`${prefix}.${payload}`, keys).ok).toBe(false);
    expect(verifyLicence(issued({ edition: "cloud" as "local" }), keys)).toEqual({ ok: false, reason: "This licence cannot be used: it is not for FITRON for Windows." });
  });

  it("says plainly when this build has no FITRON key to check with", () => {
    expect(verifyLicence(issued(), [])).toEqual({ ok: false, reason: expect.stringContaining("has no licence key built in") });
  });

  it("ships with no private key and no test key among the trusted ones", () => {
    expect(FITRON_LICENCE_KEYS.every((k) => !/test|dev/i.test(k.id))).toBe(true);
  });
});

describe("where an installation stands", () => {
  const at = (today: string, licence: Licence | null, installationId = INSTALL) => licenceStatus({ today, installedOn: "2026-10-01", installationId, licence });

  it("runs a 30-day trial from installation, then stops adding new records", () => {
    expect(at("2026-10-01", null)).toMatchObject({ kind: "trial", until: "2026-10-30", daysLeft: 30, branches: 3 });
    expect(at("2026-10-30", null)).toMatchObject({ kind: "trial", daysLeft: 1 });
    const ended = at("2026-10-31", null);
    expect(ended).toMatchObject({ kind: "ended", since: "2026-10-31", licence: null });
    expect(licenceWritable(ended)).toBe(false);
  });

  it("is active to the last day, keeps working through the grace days, then stops adding new records", () => {
    expect(at("2027-09-30", base)).toMatchObject({ kind: "active", daysLeft: 1, branches: 2 });
    const grace = at("2027-10-01", base);
    expect(grace).toMatchObject({ kind: "grace", graceUntil: "2027-10-15", daysLeft: 15 });
    expect(licenceWritable(grace)).toBe(true);
    expect(at("2027-10-16", base)).toMatchObject({ kind: "ended", since: "2027-10-16" });
  });

  it("does not count a licence made for another computer", () => {
    const bound = { ...base, installationId: "another-computer" };
    expect(at("2026-10-05", bound)).toMatchObject({ kind: "wrong-computer", trial: { daysLeft: 26 } });
    expect(licenceWritable(at("2026-10-05", bound))).toBe(true);
    expect(licenceWritable(at("2026-12-01", bound))).toBe(false);
    expect(at("2026-12-01", { ...base, installationId: INSTALL })).toMatchObject({ kind: "active" });
  });
});

describe("the licence on this computer", () => {
  let root = "";
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  const setUp = () => {
    root = mkdtempSync(path.join(os.tmpdir(), "fitron-licence-"));
    writeFileSync(path.join(root, "secrets.json"), JSON.stringify({ installationId: INSTALL, createdAt: "2026-10-01T05:00:00.000Z" }));
  };

  it("imports a good licence, refuses one for another computer, and reads it back", () => {
    setUp();
    expect(readLicence(root, "2026-10-02", keys)).toMatchObject({ status: { kind: "trial" }, installationId: INSTALL, problem: null, hasKey: true });
    expect(importLicence(root, issued({ installationId: "another-computer" }), "2026-10-02", keys)).toEqual({ ok: false, reason: expect.stringContaining("another computer") });
    expect(importLicence(root, issued({ installationId: INSTALL }), "2026-10-02", keys)).toMatchObject({ ok: true });
    expect(readLicence(root, "2026-10-02", keys).status).toMatchObject({ kind: "active", licence: { licensee: "Iron Gym, Pune" } });
  });

  it("reports a damaged licence file and falls back to the trial rules", () => {
    setUp();
    writeFileSync(licenceFile(root), "FITRON-LICENCE-1.garbage.garbage");
    expect(readLicence(root, "2026-10-02", keys)).toMatchObject({ status: { kind: "trial" }, problem: "This licence file is damaged." });
  });

  it("does not give back days when the computer's clock is wound back", () => {
    setUp();
    expect(readLicence(root, "2026-11-05", keys).status.kind).toBe("ended");
    expect(readLicence(root, "2026-10-05", keys).status).toMatchObject({ kind: "ended" });
    expect(JSON.parse(readFileSync(path.join(root, "licence-state.json"), "utf8"))).toEqual({ lastSeen: "2026-11-05" });
  });
});
