// Where the end-to-end tests run: a production build of the app (`next start`) on its own port, against the same
// database CI migrates for the unit tests. Shared by playwright.config.ts and the helpers in support.ts.
export const PORT = Number(process.env.E2E_PORT ?? 3100);
export const BASE_URL = `http://localhost:${PORT}`;
/** "local" runs the suite against the Local Windows Edition: the same app on a SQLite file (npm run e2e:local). */
export const EDITION = process.env.E2E_EDITION === "local" ? "local" : "cloud";
export const DATABASE_URL = process.env.DATABASE_URL ?? (EDITION === "local" ? "file:./.local-e2e/data/fitron.db" : "postgresql://postgres:postgres@localhost:5432/fitron_test");

/** What the server under test is started with. Production mode refuses two-step setup without these two keys. */
export const SERVER_ENV = {
  DATABASE_URL,
  BIOMETRIC_KEY: "e2e-only-biometric-key",
  AUTH_SECRET: "e2e-only-auth-secret",
  // Enforced, so a page that breaks under the policy fails here instead of in front of a customer.
  CSP_MODE: "enforce",
  NEXT_TELEMETRY_DISABLED: "1",
  // The suite makes a fresh gym per test through the fitron.in sign-up, which a shipped Local Edition never offers;
  // FITRON_LOCAL_ALLOW_SIGNUP opens it for the suite only. First-run setup has its own spec (e2e/local/startup.spec.ts).
  // FITRON_LOCAL_SCHEDULER off: the Cloud server under test has no scheduler either, so no daily job or automatic backup
  // changes a spec's data part-way (the timer has its own tests: src/lib/services/local-jobs.db.test.ts).
  ...(EDITION === "local" ? { FITRON_EDITION: "local", FITRON_DATA_DIR: "./.local-e2e", FITRON_LOCAL_ALLOW_SIGNUP: "1", FITRON_LOCAL_SCHEDULER: "off" } : {}),
};
