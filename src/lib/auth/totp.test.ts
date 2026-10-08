import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, codeAt, generateRecoveryCodes, generateSecret, groupSecret, normalizeRecoveryCode, otpauthUrl, stepAt, verifyCode } from "./totp";

// RFC 6238 appendix B: the secret "12345678901234567890", 8-digit codes at these times. The 6-digit code is the last six.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));
const RFC: [number, string][] = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

describe("codes", () => {
  it.each(RFC)("match the RFC 6238 test value at %i seconds", (t, eight) => {
    expect(codeAt(RFC_SECRET, stepAt(t * 1000), 8)).toBe(eight);
    expect(codeAt(RFC_SECRET, stepAt(t * 1000))).toBe(eight.slice(2));
  });

  it("are six digits, with leading zeros kept", () => {
    expect(codeAt(RFC_SECRET, stepAt(1111111109 * 1000))).toBe("081804");
  });
});

describe("base32", () => {
  it("round-trips, and ignores case, spaces, dashes and padding when reading", () => {
    const bytes = Buffer.from("hello, fitron!");
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
    expect(base32Decode(groupSecret(base32Encode(bytes)).toLowerCase()).equals(bytes)).toBe(true);
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
  });

  it("refuses a character that is not in the alphabet", () => {
    expect(() => base32Decode("ABC1")).toThrow();
  });
});

describe("a new secret", () => {
  it("is 32 base32 characters, a new one each time", () => {
    const a = generateSecret();
    expect(a).toMatch(/^[A-Z2-7]{32}$/);
    expect(generateSecret()).not.toBe(a);
  });
});

describe("checking a code", () => {
  const secret = RFC_SECRET;
  const now = 1111111109 * 1000;
  const step = stepAt(now);

  it("accepts the code for now, and returns its step", () => {
    expect(verifyCode(secret, "081804", now)).toBe(step);
  });

  it("accepts the step before and the step after, for a phone clock that is a little off, and no further", () => {
    expect(verifyCode(secret, codeAt(secret, step - 1), now)).toBe(step - 1);
    expect(verifyCode(secret, codeAt(secret, step + 1), now)).toBe(step + 1);
    expect(verifyCode(secret, codeAt(secret, step - 2), now)).toBeNull();
    expect(verifyCode(secret, codeAt(secret, step + 2), now)).toBeNull();
  });

  it("refuses a code that has been used, or an older one: lastStep is the latest accepted", () => {
    expect(verifyCode(secret, "081804", now, step - 1)).toBe(step);
    expect(verifyCode(secret, "081804", now, step)).toBeNull();
    expect(verifyCode(secret, codeAt(secret, step - 1), now, step)).toBeNull();
    expect(verifyCode(secret, codeAt(secret, step + 1), now, step)).toBe(step + 1);
  });

  it("refuses a wrong code and anything that is not six digits", () => {
    for (const bad of ["000000", "081805", "08180", "0818040", "abcdef", "", "08 18 04x", "٠٨١٨٠٤"]) expect(verifyCode(secret, bad, now), bad).toBeNull();
  });

  it("reads a code typed in groups", () => {
    expect(verifyCode(secret, "081 804", now)).toBe(step);
    expect(verifyCode(secret, " 081-804 ", now)).toBe(step);
  });
});

describe("the address for an authenticator app", () => {
  it("carries the secret, the issuer and the settings, with the account escaped", () => {
    const url = otpauthUrl({ secret: "ABCDEFGH", account: "asha+gym@example.com", issuer: "FITRON" });
    expect(url).toBe("otpauth://totp/FITRON:asha%2Bgym%40example.com?secret=ABCDEFGH&issuer=FITRON&algorithm=SHA1&digits=6&period=30");
  });
});

describe("recovery codes", () => {
  it("are ten, each like K7QX2-M9PTA, all different, from letters and digits that are not mistaken for each other", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/);
  });

  it("are read back whatever the case, spacing or dashes", () => {
    expect(normalizeRecoveryCode("k7qx2-m9pta")).toBe("K7QX2M9PTA");
    expect(normalizeRecoveryCode(" K7QX2 M9PTA ")).toBe("K7QX2M9PTA");
    expect(normalizeRecoveryCode("K7QX2M9PTA")).toBe("K7QX2M9PTA");
  });

  it("are not mistaken for anything else", () => {
    for (const bad of ["", "123456", "K7QX2-M9PT", "K7QX2-M9PTAA", "K7QX0-M9PTA", "K7QXO-M9PTA"]) expect(normalizeRecoveryCode(bad), bad).toBeNull();
  });
});
