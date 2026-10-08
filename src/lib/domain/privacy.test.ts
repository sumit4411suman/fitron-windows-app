import { describe, expect, it } from "vitest";
import { DEFAULT_NOTICE, NOTICE_KEYS, anonymisedMember, editedSections, filledPersonalFields, renderNotice, retentionCutoff } from "./privacy";

describe("anonymisedMember", () => {
  it("clears every personal field and sets erasedAt", () => {
    const now = new Date("2026-10-04T10:00:00Z");
    const a = anonymisedMember(now, null);
    expect(a.name).toBe("Erased member");
    expect(a.phone).toBe("");
    expect(a.tags).toEqual([]);
    expect(a.riskReasons).toEqual([]);
    expect(a.erasedAt).toBe(now);
    expect(a.deletedAt).toBe(now);
    for (const k of ["whatsapp", "email", "dob", "occupation", "house", "area", "city", "state", "pin", "emergencyName", "emergencyRelation", "emergencyPhone", "notes", "staffNotes", "photoKey", "oldId", "riskScore", "trainerId"] as const) {
      expect(a[k]).toBeNull();
    }
    // A new personal column on Member must be added here (and so to the erasure) before this passes again.
    expect(Object.keys(a)).toEqual([
      "name",
      "phone",
      "whatsapp",
      "email",
      "dob",
      "occupation",
      "house",
      "area",
      "city",
      "state",
      "pin",
      "emergencyName",
      "emergencyRelation",
      "emergencyPhone",
      "notes",
      "staffNotes",
      "tags",
      "photoKey",
      "oldId",
      "riskScore",
      "riskReasons",
      "trainerId",
      "deletedAt",
      "erasedAt",
    ]);
  });

  it("keeps an earlier deletedAt", () => {
    const gone = new Date("2026-01-01T00:00:00Z");
    expect(anonymisedMember(new Date(), gone).deletedAt).toBe(gone);
  });

  it("names the filled fields without their values", () => {
    expect(filledPersonalFields({ name: "Asha", phone: "9876543210", email: null, tags: [], riskReasons: ["x"], code: "PHG-1" })).toEqual(["name", "phone", "riskReasons"]);
  });
});

describe("privacy notice", () => {
  it("has the nine sections in the prototype's order", () => {
    expect(NOTICE_KEYS).toEqual(["who", "collect", "why", "consent", "rights", "children", "retention", "security", "sharing"]);
    expect(Object.keys(DEFAULT_NOTICE)).toEqual([...NOTICE_KEYS]);
  });

  it("fills the gym name and prefers a saved section", () => {
    const out = renderNotice({ notice: { why: "Only to run the gym." } }, "Power Haus Gym");
    expect(out[0]).toEqual({ key: "who", title: "Who we are", text: expect.stringMatching(/^Power Haus Gym is the Data Fiduciary/) });
    expect(out.find((s) => s.key === "why")?.text).toBe("Only to run the gym.");
    expect(out.find((s) => s.key === "sharing")?.text).toBe(DEFAULT_NOTICE.sharing);
  });

  it("stores only the sections that differ from the template, with the gym name as a placeholder", () => {
    expect(editedSections({ who: DEFAULT_NOTICE.who, why: `${DEFAULT_NOTICE.why} We never share it for marketing.`, rights: "  " })).toEqual({ why: `${DEFAULT_NOTICE.why} We never share it for marketing.` });
    const rendered = DEFAULT_NOTICE.who.replaceAll("{{gymName}}", "Power Haus Gym");
    expect(editedSections({ who: rendered }, "Power Haus Gym")).toEqual({});
    expect(editedSections({ who: `${rendered} Call Power Haus Gym any time.` }, "Power Haus Gym")).toEqual({ who: `${DEFAULT_NOTICE.who} Call {{gymName}} any time.` });
  });
});

describe("retentionCutoff", () => {
  it("goes back whole months, clamping at month end", () => {
    expect(retentionCutoff("2026-10-04", 24)).toBe("2024-10-04");
    expect(retentionCutoff("2026-03-31", 1)).toBe("2026-02-28");
    expect(retentionCutoff("2026-10-04", 1.9)).toBe("2026-09-04");
  });
  it("is off at 0", () => {
    expect(retentionCutoff("2026-10-04", 0)).toBeNull();
    expect(retentionCutoff("2026-10-04", -3)).toBeNull();
  });
});
