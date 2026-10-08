"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/client-error";

// The last resort: the page layout itself failed, so none of the site's styles or components can be relied on. It brings
// its own <html>, <body> and plain inline styles.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => reportClientError(error, "global"), [error]);
  return (
    <html lang="en-IN">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#0e0d0a", color: "#f3ede0", fontFamily: "system-ui, sans-serif" }}>
        <main role="alert" style={{ maxWidth: 520, padding: 24 }}>
          <title>Something went wrong · FITRON</title>
          <h1 style={{ fontSize: 28, margin: "0 0 12px" }}>Something went wrong</h1>
          <p style={{ color: "#a99f8c", lineHeight: 1.5 }}>FITRON hit a problem on our side. Try again. If it keeps happening, tell us at hello@fitron.in{error.digest ? ` and quote reference ${error.digest}` : ""}.</p>
          <button type="button" onClick={() => retry()} style={{ marginTop: 12, padding: "10px 18px", borderRadius: 6, border: 0, background: "#cfa94f", color: "#0e0d0a", fontWeight: 600, cursor: "pointer" }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
