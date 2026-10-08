import { afterEach, describe, expect, it, vi } from "vitest";
import { authUrl, newPkce, profileFromIdToken, sign, unsign } from "./google";
import { createHash } from "node:crypto";

const NOW = Date.UTC(2026, 9, 2, 6, 0, 0);
const token = (claims: Record<string, unknown>) =>
  ["e30", Buffer.from(JSON.stringify(claims)).toString("base64url"), "sig"].join(".");
const good = { aud: "client-1", iss: "https://accounts.google.com", exp: NOW / 1000 + 300, sub: "123", email: "Owner@Gym.in", email_verified: true, name: "Gym Owner", picture: "https://x/p.jpg" };

afterEach(() => vi.unstubAllEnvs());

describe("profileFromIdToken", () => {
  it("reads a valid Google ID token", () => {
    expect(profileFromIdToken(token(good), "client-1", NOW)).toEqual({ sub: "123", email: "owner@gym.in", name: "Gym Owner", picture: "https://x/p.jpg" });
  });
  it("rejects a token for another app, another issuer, an expired one or an unverified email", () => {
    expect(() => profileFromIdToken(token({ ...good, aud: "other" }), "client-1", NOW)).toThrow(/another app/);
    expect(() => profileFromIdToken(token({ ...good, iss: "https://evil.example" }), "client-1", NOW)).toThrow(/not from Google/);
    expect(() => profileFromIdToken(token({ ...good, exp: NOW / 1000 - 1 }), "client-1", NOW)).toThrow(/expired/);
    expect(() => profileFromIdToken(token({ ...good, email_verified: false }), "client-1", NOW)).toThrow(/verified/);
    expect(() => profileFromIdToken("nope", "client-1", NOW)).toThrow(/Malformed/);
  });
});

describe("sign / unsign", () => {
  it("round-trips until it expires", () => {
    vi.stubEnv("AUTH_SECRET", "test-secret");
    const t = sign({ email: "a@b.in" }, 60_000, NOW);
    expect(unsign<{ email: string }>(t, NOW + 59_000)?.email).toBe("a@b.in");
    expect(unsign(t, NOW + 61_000)).toBeNull();
  });
  it("refuses a tampered body or a different key", () => {
    vi.stubEnv("AUTH_SECRET", "test-secret");
    const t = sign({ email: "a@b.in" }, 60_000, NOW);
    const [, mac] = t.split(".");
    const forged = `${Buffer.from(JSON.stringify({ email: "boss@b.in", exp: NOW + 60_000 })).toString("base64url")}.${mac}`;
    expect(unsign(forged, NOW)).toBeNull();
    vi.stubEnv("AUTH_SECRET", "other-secret");
    expect(unsign(t, NOW)).toBeNull();
  });
});

describe("PKCE and the Google URL", () => {
  it("sends the S256 challenge of the verifier", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-1");
    const p = newPkce();
    expect(p.challenge).toBe(createHash("sha256").update(p.verifier).digest("base64url"));
    const u = new URL(authUrl({ redirectUri: "https://fitron.in/auth/google/callback", state: p.state, challenge: p.challenge }));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ client_id: "client-1", redirect_uri: "https://fitron.in/auth/google/callback", code_challenge: p.challenge, code_challenge_method: "S256", state: p.state, scope: "openid email profile" });
  });
});
