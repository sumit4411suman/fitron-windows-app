import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Phase 12: every conversation with the internet lives in src/lib/integrations (email, whatsapp, razorpay, ai, license,
// updates, and the Cloud Edition's google sign-in), where each one follows the offline rule (online.ts) and states what
// it sends. Nothing else in the app may open a connection, so customer data cannot leave by a side door. This fails when
// a new fetch to another computer, mail client, socket or push library appears anywhere else.

const SRC = path.join(__dirname, "../..");
const INTEGRATIONS = path.join(SRC, "lib/integrations") + path.sep;

/** The two that sit elsewhere, both Cloud Edition only, each with why it cannot run on FITRON for Windows. */
const ELSEWHERE: Record<string, string> = {
  "lib/storage/s3-storage.ts": "the Cloud Edition's file bucket; the Local Edition always stores files on its own disk (src/lib/storage/index.ts)",
  "lib/services/trainer-push.ts": "AI Trainer reminders; its routes answer 404 on FITRON for Windows (notInLocal)",
};

function files(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "generated") out.push(...files(p));
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Network use in a source file: a fetch to anything but this app's own addresses, or a network library. */
function networkUse(src: string): string[] {
  const found: string[] = [];
  for (const m of src.matchAll(/\bfetch\(\s*([^,)]*)/g)) {
    const arg = m[1]!.trim();
    // Same-origin: "/api/…", `/api/${x}`, or a variable the file built from such a path.
    if (/^["'`]\//.test(arg)) continue;
    found.push(`fetch(${arg.slice(0, 40)}`);
  }
  for (const m of src.matchAll(/from\s+["'](nodemailer|web-push|ws|undici|node:https?|https?|node:net|net|node:tls|tls|node:dgram|dgram)["']/g)) found.push(`import ${m[1]}`);
  for (const m of src.matchAll(/\b(sendBeacon|new WebSocket|new EventSource|XMLHttpRequest)\b/g)) found.push(m[1]!);
  return found;
}

describe("only the integrations talk to the internet", () => {
  const all = files(SRC);

  it("scans the whole app", () => {
    expect(all.length).toBeGreaterThan(400);
  });

  it("finds no network use outside src/lib/integrations, but for the two Cloud-only exceptions", () => {
    const outside = all
      .filter((f) => !f.startsWith(INTEGRATIONS))
      .flatMap((f) => {
        const rel = path.relative(SRC, f).split(path.sep).join("/");
        const uses = networkUse(readFileSync(f, "utf8"));
        return uses.length && !ELSEWHERE[rel] ? [`${rel}: ${uses.join(", ")}`] : [];
      });
    expect(outside).toEqual([]);
  });

  it("each exception still is network code, so the list stays honest", () => {
    for (const rel of Object.keys(ELSEWHERE)) expect(networkUse(readFileSync(path.join(SRC, rel), "utf8")), rel).not.toEqual([]);
  });

  it("the console's own pages name no other website but the ones listed here, each opened by a person or closed on FITRON for Windows", () => {
    // Links and scripts in the browser: each address a console page can open or load, and why it is allowed.
    const ALLOWED: Record<string, string> = {
      "https://wa.me/91": "click-to-chat a staff member presses (Leads, Attendance › Nudge); checks the network first",
      "https://checkout.razorpay.com/v1/checkout.js": "FITRON plan billing; /settings/billing is closed on FITRON for Windows",
      "https://connect.facebook.net/en_US/sdk.js": "Meta's Connect WhatsApp window, only when a gym presses Connect and Meta is set up",
      "https://www.facebook.com": "the origin Meta's Connect window answers from (cloud-connect.tsx)",
      "https://web.facebook.com": "the origin Meta's Connect window answers from (cloud-connect.tsx)",
      "https://youtube.com/shorts/": "the FITRON team console's AI Trainer content; closed on FITRON for Windows",
    };
    const consoleDirs = ["app/(app)", "app/login", "app/setup", "app/recover", "app/onboarding", "components"].map((d) => path.join(SRC, d) + path.sep);
    const found = all
      .filter((f) => consoleDirs.some((d) => f.startsWith(d)))
      .flatMap((f) => [...readFileSync(f, "utf8").matchAll(/https?:\/\/(\$\{|[A-Za-z0-9./_-])[A-Za-z0-9./_${}-]*/g)].map((m) => ({ f: path.relative(SRC, f), url: m[0] })))
      .filter(({ url }) => !Object.keys(ALLOWED).some((a) => url === a || url.startsWith(a)) && !/^https?:\/\/(www\.)?w3\.org\//.test(url));
    expect(found).toEqual([]);
  });

  it("each online service has its own folder", () => {
    for (const s of ["email", "whatsapp", "razorpay", "ai", "license", "updates"]) expect(readdirSync(path.join(INTEGRATIONS, s)), s).toContain("index.ts");
  });
});
