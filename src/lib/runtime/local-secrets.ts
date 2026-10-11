import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

// Keys the server needs that a hosted deployment sets as environment variables: BIOMETRIC_KEY (seals two-step secrets
// and biometric templates), AUTH_SECRET (signs short-lived sign-in cookies) and CRON_SECRET (the job runner). A desktop
// installation has nobody to set them, so each installation makes its own once, in <data>/secrets.json, and keeps them.
// They are never the same on two computers and never leave this one, except inside the customer's own backup (a
// restored laptop needs BIOMETRIC_KEY to read its two-step secrets). Phase 19 seals this file with Windows DPAPI.

export type LocalSecrets = { installationId: string; BIOMETRIC_KEY: string; AUTH_SECRET: string; CRON_SECRET: string; createdAt: string };

const KEYS = ["BIOMETRIC_KEY", "AUTH_SECRET", "CRON_SECRET"] as const;

export const secretsFile = (root: string) => path.join(root, "secrets.json");

export function ensureLocalSecrets(root: string, env: Record<string, string | undefined> = process.env): LocalSecrets {
  const file = secretsFile(root);
  let s: Partial<LocalSecrets> = {};
  if (existsSync(file)) s = JSON.parse(readFileSync(file, "utf8")) as Partial<LocalSecrets>;
  const before = JSON.stringify(s);
  s.installationId ??= randomUUID();
  for (const k of KEYS) s[k] ||= randomBytes(32).toString("hex");
  s.createdAt ??= new Date().toISOString();
  const changed = JSON.stringify(s) !== before;
  if (changed) {
    // Written to a temporary file and renamed, so a power cut never leaves half a key file.
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
  }
  for (const k of KEYS) if (!env[k]) env[k] = s[k];
  return s as LocalSecrets;
}
