import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureLocalSecrets, readLocalSecrets, secretsFile, writeRestoredSecrets } from "./local-secrets";

// Phase 19: the installation's secrets come from the desktop shell's environment (sealed with DPAPI on disk) when it
// started the server, and from secrets.json only on a server started by hand (tests, Linux).

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "fitron-secrets-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const shellEnv = () => ({ FITRON_SECRETS: "shell", FITRON_INSTALLATION_ID: "inst-1", FITRON_INSTALLED_AT: "2026-01-02T03:04:05.000Z", BIOMETRIC_KEY: "b".repeat(64), AUTH_SECRET: "a".repeat(64), CRON_SECRET: "c".repeat(64) });

describe("secrets held by the desktop shell", () => {
  it("come from the environment, and no file is ever written", () => {
    const env: Record<string, string | undefined> = shellEnv();
    const s = ensureLocalSecrets(root, env);
    expect(s).toEqual({ installationId: "inst-1", createdAt: "2026-01-02T03:04:05.000Z", BIOMETRIC_KEY: "b".repeat(64), AUTH_SECRET: "a".repeat(64), CRON_SECRET: "c".repeat(64) });
    expect(existsSync(secretsFile(root))).toBe(false);
    expect(readLocalSecrets(root, env)).toMatchObject({ installationId: "inst-1", BIOMETRIC_KEY: "b".repeat(64) });
    // A plain file left on disk is not read while the shell holds the secrets.
    writeFileSync(secretsFile(root), JSON.stringify({ installationId: "other", BIOMETRIC_KEY: "x" }));
    expect(readLocalSecrets(root, env).installationId).toBe("inst-1");
  });

  it("refuse to run on a shell that passed too little", () => {
    const env: Record<string, string | undefined> = { ...shellEnv(), AUTH_SECRET: "" };
    expect(() => ensureLocalSecrets(root, env)).toThrow(/AUTH_SECRET/);
  });

  it("after a restore, write the restored key with the whole installation for the shell to seal next time", () => {
    const env: Record<string, string | undefined> = shellEnv();
    writeRestoredSecrets(root, env, { BIOMETRIC_KEY: "r".repeat(64) });
    const written = JSON.parse(readFileSync(secretsFile(root), "utf8")) as Record<string, string>;
    expect(written).toEqual({ installationId: "inst-1", createdAt: "2026-01-02T03:04:05.000Z", BIOMETRIC_KEY: "r".repeat(64), AUTH_SECRET: "a".repeat(64), CRON_SECRET: "c".repeat(64) });
    // And the running server uses it at once.
    expect(env.BIOMETRIC_KEY).toBe("r".repeat(64));
  });
});

describe("secrets in secrets.json (a server started by hand)", () => {
  it("are made once, kept, and filled in when a key is missing", () => {
    const env: Record<string, string | undefined> = {};
    const a = ensureLocalSecrets(root, env);
    expect(a.installationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.BIOMETRIC_KEY).toMatch(/^[0-9a-f]{64}$/);
    expect(env.BIOMETRIC_KEY).toBe(a.BIOMETRIC_KEY);
    const b = ensureLocalSecrets(root, {});
    expect(b).toEqual(a);
    writeFileSync(secretsFile(root), JSON.stringify({ installationId: a.installationId, createdAt: a.createdAt }));
    const c = ensureLocalSecrets(root, {});
    expect(c.installationId).toBe(a.installationId);
    expect(c.BIOMETRIC_KEY).toMatch(/^[0-9a-f]{64}$/);
    expect(c.BIOMETRIC_KEY).not.toBe(a.BIOMETRIC_KEY);
    expect(readLocalSecrets(path.join(root, "nowhere"), {})).toEqual({});
  });

  it("keep a restored key in the file", () => {
    const env: Record<string, string | undefined> = {};
    const a = ensureLocalSecrets(root, env);
    writeRestoredSecrets(root, env, { BIOMETRIC_KEY: "r".repeat(64) });
    expect(readLocalSecrets(root, env)).toEqual({ ...a, BIOMETRIC_KEY: "r".repeat(64) });
    expect(env.BIOMETRIC_KEY).toBe("r".repeat(64));
  });
});
