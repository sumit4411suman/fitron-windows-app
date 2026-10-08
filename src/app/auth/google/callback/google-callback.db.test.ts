import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { hasDb, makeGym } from "@/test/db";

// Google's token exchange and the cookie writers are the only things replaced; the route, the database
// and the signed flow cookie are real.
const google = vi.hoisted(() => ({ email: "" }));
vi.mock("@/lib/integrations/google", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations/google")>()),
  exchangeCode: vi.fn(async () => ({ sub: "sub-1", email: google.email, name: "Some One", picture: null })),
}));
vi.mock("@/lib/auth/session", () => ({ createSession: vi.fn() }));
vi.mock("@/lib/services/trainer-session", () => ({ createTrainerSession: vi.fn() }));

import { GOOGLE_FLOW_COOKIE, sign, unsign, type GoogleFlow } from "@/lib/integrations/google";
import { codeAt, stepAt } from "@/lib/auth/totp";
import { beginTwoStep, confirmTwoStep } from "@/lib/services/two-step";
import { createSession } from "@/lib/auth/session";
import { createTrainerSession } from "@/lib/services/trainer-session";
import { GET } from "./route";

const email = () => `gcb-${randomUUID().slice(0, 8)}@test.local`;

/** The callback as Google would call it, after a flow that started with ?for=<flow>. */
function callback(flow: GoogleFlow, o: { plan?: string; cycle?: string; error?: boolean } = {}) {
  const state = `${flow}.abc`;
  const cookie = `${GOOGLE_FLOW_COOKIE}=${sign({ state, verifier: "v", flow, next: "", plan: o.plan ?? "", cycle: o.cycle ?? "" }, 600_000)}`;
  const q = o.error ? `error=access_denied&state=${state}` : `code=c&state=${state}`;
  return GET(new NextRequest(`http://localhost/auth/google/callback?${q}`, { headers: { cookie } }));
}
const where = (r: Response) => {
  const u = new URL(r.headers.get("location")!);
  return u.pathname + u.search;
};

beforeEach(() => vi.clearAllMocks());

describe.skipIf(!hasDb)("Google callback, between Gym Accounting and the AI Trainer (database)", () => {
  it("opens the AI Trainer for a Google account that has no gym login but has an AI Trainer account", async () => {
    google.email = email();
    const member = await db.trainerMember.create({ data: { email: google.email, name: "Member" } });
    const res = await callback("staff");
    expect(where(res)).toBe("/trainer");
    expect(createTrainerSession).toHaveBeenCalledTimes(1);
    expect(createTrainerSession).toHaveBeenCalledWith(member.id);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("still says there is no account when the email is in neither product, and creates nothing", async () => {
    google.email = email();
    const res = await callback("staff");
    expect(where(res)).toBe(`/login?google=nouser&email=${encodeURIComponent(google.email)}`);
    expect(createTrainerSession).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
    expect(await db.trainerMember.findUnique({ where: { email: google.email } })).toBeNull();
  });

  it("signs gym staff into the console, even if the same email also has an AI Trainer account", async () => {
    const g = await makeGym();
    const owner = await g.user("Super Admin");
    const row = await db.user.findUniqueOrThrow({ where: { id: owner.id } });
    google.email = row.email;
    await db.trainerMember.create({ data: { email: row.email, name: "Both" } });
    const res = await callback("staff");
    expect(where(res)).toBe("/dashboard");
    expect(createSession).toHaveBeenCalledWith(owner.id);
    expect(createTrainerSession).not.toHaveBeenCalled();
  });

  it("asks for the second step, and opens no session yet, for staff who use two-step sign-in", async () => {
    const g = await makeGym();
    const owner = await g.user("Super Admin");
    const { secret } = await beginTwoStep(owner);
    await confirmTwoStep(owner, codeAt(secret, stepAt(Date.now())));
    google.email = (await db.user.findUniqueOrThrow({ where: { id: owner.id } })).email;
    const res = await callback("staff");
    expect(where(res)).toBe("/login?step=2");
    expect(createSession).not.toHaveBeenCalled();
    const set = res.headers.get("set-cookie") ?? "";
    expect(set).toContain("fitron_2fa=");
    // The cookie says who, where to, and that Google got them this far; it is signed and short-lived, and is not a session.
    const value = decodeURIComponent(set.match(/fitron_2fa=([^;]+)/)![1]!);
    expect(unsign<{ uid: string; next: string; via: string; exp: number }>(value)).toMatchObject({ uid: owner.id, next: "/dashboard", via: "google" });
    expect(set).not.toContain("fitron_session");
    expect(await db.auditLog.count({ where: { entityId: owner.id, action: "auth.login" } })).toBe(0);
  });

  it("does not take someone who is creating a gym away to the AI Trainer", async () => {
    google.email = email();
    await db.trainerMember.create({ data: { email: google.email, name: "Member" } });
    const res = await callback("signup", { plan: "starter", cycle: "YEARLY" });
    expect(where(res)).toBe("/login?tab=up&plan=starter&cycle=YEARLY&google=1");
    expect(res.headers.get("set-cookie")).toContain("fitron_google_signup=");
    expect(createTrainerSession).not.toHaveBeenCalled();
  });

  it("brings a cancelled gym sign-up back to the Create account tab with its plan", async () => {
    google.email = email();
    const res = await callback("signup", { plan: "enterprise", cycle: "MONTHLY", error: true });
    expect(where(res)).toBe("/login?tab=up&plan=enterprise&cycle=MONTHLY&google=cancelled");
  });
});
