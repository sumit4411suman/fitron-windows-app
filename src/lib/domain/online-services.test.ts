import { describe, expect, it } from "vitest";
import { onlineServices, type OnlineServicesState } from "./online-services";

const fresh: OnlineServicesState = {
  whatsapp: { mode: "demo", automatic: false },
  email: { ready: false, monthlyPl: false },
  ai: { enabled: true, keySet: false, useClaude: false },
  autopay: { mode: "demo", keysSet: false },
  licence: { configured: false },
  updates: { configured: false },
};

describe("online services on FITRON for Windows", () => {
  it("sends nothing anywhere on a fresh installation", () => {
    const rows = onlineServices(fresh);
    expect(rows.map((r) => r.key)).toEqual(["whatsapp", "email", "ai", "autopay", "licence", "updates"]);
    expect(rows.filter((r) => r.on)).toEqual([]);
    expect(rows.find((r) => r.key === "whatsapp")!.sends).toBe("Nothing. Messages are saved on this computer.");
  });

  it("says what each service sends once it is on", () => {
    const rows = onlineServices({
      whatsapp: { mode: "cloud", automatic: true },
      email: { ready: true, monthlyPl: true },
      ai: { enabled: true, keySet: true, useClaude: true },
      autopay: { mode: "live", keysSet: true },
      licence: { configured: true },
      updates: { configured: true },
    });
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(rows.every((r) => r.on)).toBe(true);
    expect(by.whatsapp!.sends).toContain("renewal invoices as PDFs");
    expect(by.email!.sends).toContain("profit and loss");
    expect(by.ai!.sends).toContain("Anthropic's Claude (USA)");
    expect(by.autopay!.sends).toContain("Not the member's name or phone");
    expect(by.licence!.sends).toContain("Never gym data");
  });

  it("does not count a key FITRON set as the gym's choice: Claude stays off until ticked", () => {
    const ai = onlineServices({ ...fresh, ai: { enabled: true, keySet: true, useClaude: false } }).find((r) => r.key === "ai")!;
    expect(ai).toMatchObject({ on: false, state: "Answers from this computer", sends: "Nothing." });
  });
});
