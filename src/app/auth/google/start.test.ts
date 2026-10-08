import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GOOGLE_FLOW_COOKIE } from "@/lib/integrations/google";
import { GET } from "./route";

beforeEach(() => {
  vi.stubEnv("APP_URL", "https://fitron.in");
  vi.stubEnv("GOOGLE_CLIENT_ID", "id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
  vi.stubEnv("AUTH_SECRET", "test-secret");
});
afterEach(() => vi.unstubAllEnvs());

describe("/auth/google", () => {
  // Vercel sends fitron.in to www.fitron.in; sending www back to APP_URL's host looped forever (ERR_TOO_MANY_REDIRECTS).
  it.each(["https://fitron.in", "https://www.fitron.in"])("goes straight to Google with the flow cookie from %s", (origin) => {
    const res = GET(new NextRequest(`${origin}/auth/google?for=trainer&next=/trainer`));
    const to = new URL(res.headers.get("location")!);
    expect(to.origin).toBe("https://accounts.google.com");
    expect(to.searchParams.get("redirect_uri")).toBe("https://fitron.in/auth/google/callback");
    expect(res.cookies.get(GOOGLE_FLOW_COOKIE)?.value).toBeTruthy();
  });
});
