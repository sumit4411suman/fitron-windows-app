import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

// Keys the server needs that a hosted deployment sets as environment variables: BIOMETRIC_KEY (seals two-step secrets
// and biometric templates), AUTH_SECRET (signs short-lived sign-in cookies) and CRON_SECRET (the job runner). A desktop
// installation has nobody to set them, so each installation makes its own once and keeps them. They are never the same
// on two computers and never leave this one, except inside the customer's own backup (a restored laptop needs
// BIOMETRIC_KEY to read its two-step secrets).
//
// Two ways of holding them (Phase 19, SECURITY.md):
//   - Started by the desktop shell (FITRON_SECRETS=shell): the shell keeps them sealed with Windows DPAPI for this
//     Windows user and hands them over in the environment, with the installation id and date. The server never writes
//     them. After a restore it writes the restored key as plain secrets.json once, for the shell to seal at the next
//     start.
//   - Started by hand (tests, Linux, macOS): plain <data>/secrets.json, made once, readable by this user only.

export type LocalSecrets = { installationId: string; BIOMETRIC_KEY: string; AUTH_SECRET: string; CRON_SECRET: string; createdAt: string };

const KEYS = ["BIOMETRIC_KEY", "AUTH_SECRET", "CRON_SECRET"] as const;

export const secretsFile = (root: string) => path.join(root, "secrets.json");

/** True when the desktop shell holds the secrets (sealed on disk) and handed them over in the environment. */
export const secretsFromShell = (env: Record<string, string | undefined> = process.env) => env.FITRON_SECRETS === "shell";

const fromEnv = (env: Record<string, string | undefined>): Partial<LocalSecrets> => {
  const s: Partial<LocalSecrets> = { installationId: env.FITRON_INSTALLATION_ID, createdAt: env.FITRON_INSTALLED_AT, BIOMETRIC_KEY: env.BIOMETRIC_KEY, AUTH_SECRET: env.AUTH_SECRET, CRON_SECRET: env.CRON_SECRET };
  for (const k of Object.keys(s) as (keyof LocalSecrets)[]) if (!s[k]) delete s[k];
  return s;
};

/** This installation's secrets as they are: from the shell's environment, else from secrets.json (empty if neither). */
export function readLocalSecrets(root: string, env: Record<string, string | undefined> = process.env): Partial<LocalSecrets> {
  if (secretsFromShell(env)) return fromEnv(env);
  const file = secretsFile(root);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Partial<LocalSecrets>;
  } catch {
    return {};
  }
}

export function ensureLocalSecrets(root: string, env: Record<string, string | undefined> = process.env): LocalSecrets {
  if (secretsFromShell(env)) {
    const s = fromEnv(env);
    const missing = (["installationId", ...KEYS] as const).filter((k) => !s[k]);
    if (missing.length) throw new Error(`The desktop shell said it holds the installation's secrets but did not pass ${missing.join(", ")}.`);
    return { ...s, createdAt: s.createdAt ?? new Date().toISOString() } as LocalSecrets;
  }
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

/**
 * After a restore: the keys the backup carried, written with the rest of the installation as plain secrets.json (the
 * shell seals it at the next start on Windows; by hand it is the file anyway), and used by this server at once.
 */
export function writeRestoredSecrets(root: string, env: Record<string, string | undefined>, patch: Partial<Pick<LocalSecrets, (typeof KEYS)[number]>>) {
  const next = { ...readLocalSecrets(root, env), ...patch };
  const file = secretsFile(root);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
  for (const k of KEYS) if (patch[k]) env[k] = patch[k];
}
