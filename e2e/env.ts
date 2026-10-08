// Where the end-to-end tests run: a production build of the app (`next start`) on its own port, against the same
// database CI migrates for the unit tests. Shared by playwright.config.ts and the helpers in support.ts.
export const PORT = Number(process.env.E2E_PORT ?? 3100);
export const BASE_URL = `http://localhost:${PORT}`;
export const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/fitron_test";

/** What the server under test is started with. Production mode refuses two-step setup without these two keys. */
export const SERVER_ENV = {
  DATABASE_URL,
  BIOMETRIC_KEY: "e2e-only-biometric-key",
  AUTH_SECRET: "e2e-only-auth-secret",
  // Enforced, so a page that breaks under the policy fails here instead of in front of a customer.
  CSP_MODE: "enforce",
  NEXT_TELEMETRY_DISABLED: "1",
};
