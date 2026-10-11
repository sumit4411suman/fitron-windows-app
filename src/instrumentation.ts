import type { Instrumentation } from "next";

// Runs once when the server starts. The Local Windows Edition brings its SQLite file up to date here, before the first
// request opens it: the desktop shell waits for /api/health, which only answers once this has finished.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { isLocal } = await import("@/lib/runtime/edition");
  if (!isLocal()) return;
  const { startLocalEdition } = await import("@/lib/runtime/local-start");
  await startLocalEdition();
}

// Next.js calls this for every error it catches in a page, a server action or a route handler (not for the ones our own
// code catches and logs). The work is in src/lib/observability.ts, loaded only on the Node.js server since it sends email.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportRequestError } = await import("@/lib/observability");
  await reportRequestError(err, request, context);
};
