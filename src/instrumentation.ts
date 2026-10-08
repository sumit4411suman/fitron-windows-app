import type { Instrumentation } from "next";

// Next.js calls this for every error it catches in a page, a server action or a route handler (not for the ones our own
// code catches and logs). The work is in src/lib/observability.ts, loaded only on the Node.js server since it sends email.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportRequestError } = await import("@/lib/observability");
  await reportRequestError(err, request, context);
};
