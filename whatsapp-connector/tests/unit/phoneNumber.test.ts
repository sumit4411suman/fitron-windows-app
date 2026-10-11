import { describe, expect, it } from "vitest";
import { formatPhone, fromJid, normalizePhone, toJid } from "../../src/utils/phoneNumber.js";

describe("normalizePhone", () => {
  it.each([
    ["+919876543210", "919876543210"],
    ["919876543210", "919876543210"],
    ["9876543210", "919876543210"],
    ["+91 98765 43210", "919876543210"],
    ["+91-98765-43210", "919876543210"],
    ["0091 9876543210", "919876543210"],
    ["(+91) 98765 43210", "919876543210"],
  ])("normalises Indian number %s to %s", (input, digits) => {
    const p = normalizePhone(input, "IN");
    expect(p.digits).toBe(digits);
    expect(p.e164).toBe("+" + digits);
    expect(p.country).toBe("IN");
  });

  it("does not assume every number is Indian", () => {
    expect(normalizePhone("+447911123456").digits).toBe("447911123456");
    expect(normalizePhone("+971501234567").digits).toBe("971501234567");
    expect(normalizePhone("+12025550123").country).toBe("US");
    expect(normalizePhone("7911123456", "GB").digits).toBe("447911123456");
  });

  it.each(["", "abc", "12345", "+91 1234", "98765", "+91abc", "+999999999999999"])("rejects %s", (bad) => {
    expect(() => normalizePhone(bad)).toThrowError(/phone number/i);
  });

  it("reports the INVALID_PHONE_NUMBER code", () => {
    try {
      normalizePhone("123");
      expect.fail("should throw");
    } catch (e) {
      expect((e as { code: string }).code).toBe("INVALID_PHONE_NUMBER");
    }
  });

  it("formats and converts to and from jids", () => {
    expect(formatPhone("919876543210")).toBe("+91 98765 43210");
    expect(toJid("919876543210")).toBe("919876543210@s.whatsapp.net");
    expect(fromJid("919876543210@s.whatsapp.net")).toBe("919876543210");
    expect(fromJid("919876543210:12@s.whatsapp.net")).toBe("919876543210");
    expect(fromJid("120363001@g.us")).toBeNull();
    expect(fromJid("12345@lid")).toBeNull();
    expect(fromJid(undefined)).toBeNull();
  });
});
