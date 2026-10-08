// Sent by the error pages (src/components/error-screen.tsx, src/app/global-error.tsx) when something fails in the
// browser, so the failure reaches the server log (src/app/api/client-error/route.ts). An error that has a digest
// happened on the server, which has already logged it, so only the ones without one are sent. What is sent: where it
// happened, the error's message and the page's address without its query string: no form contents, no cookies.
const sent = new Set<string>();

export function reportClientError(error: Error & { digest?: string }, where: "page" | "app" | "global") {
  try {
    if (error.digest) return;
    const key = `${where}|${error.message}`;
    if (sent.has(key)) return;
    sent.add(key);
    void fetch("/api/client-error", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ where, message: `${error.name || "Error"}: ${String(error.message)}`.slice(0, 300), at: String(error.stack ?? "").split("\n").find((l) => /^\s+at /.test(l))?.trim().slice(0, 200), path: location.pathname }),
    }).catch(() => {});
  } catch {
    // Reporting is best effort; the visitor already has the error page.
  }
}
