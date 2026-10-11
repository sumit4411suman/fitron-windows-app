import { describe, expect, it } from "vitest";
import { judgeSignatures, publisherOf, type FileSignature } from "./authenticode";

const signed = (file: string, over: Partial<FileSignature> = {}): FileSignature => ({
  file,
  status: "Valid",
  signer: "CN=FITRON Technologies Private Limited, O=FITRON Technologies Private Limited, L=Patna, S=Bihar, C=IN",
  timestamper: "CN=DigiCert Timestamp 2025, O=DigiCert, Inc., C=US",
  ...over,
});

describe("Authenticode release checks", () => {
  it("reads the publisher a person sees from the certificate's subject", () => {
    expect(publisherOf("CN=FITRON Technologies Private Limited, O=FITRON Technologies Private Limited, C=IN")).toBe("FITRON Technologies Private Limited");
    expect(publisherOf('CN="Fitron, Inc."')).toBe("Fitron");
    expect(publisherOf(null)).toBeNull();
  });

  it("passes a release whose every file is signed by FITRON and timestamped", () => {
    const v = judgeSignatures([signed("FITRON-Gym-Accounting-Setup-1.0.0.exe"), signed("fitron.exe"), signed("fitron-node.exe")], { require: true, publisher: "FITRON" });
    expect(v.ok).toBe(true);
    expect(v.lines.every((l) => l.startsWith("✓"))).toBe(true);
  });

  it("fails a release with an unsigned file, someone else's signature, a broken one or no timestamp", () => {
    for (const bad of [
      signed("fitron.exe", { status: "NotSigned", signer: null, timestamper: null }),
      signed("fitron.exe", { signer: "CN=Someone Else, O=Someone Else Ltd" }),
      signed("fitron.exe", { status: "HashMismatch" }),
      signed("fitron.exe", { timestamper: null }),
    ]) {
      const v = judgeSignatures([signed("setup.exe"), bad], { require: true, publisher: "FITRON" });
      expect(v.ok, JSON.stringify(bad)).toBe(false);
      expect(v.lines.find((l) => l.includes("fitron.exe"))).toMatch(/^✗/);
    }
    expect(judgeSignatures([], { require: true, publisher: "FITRON" }).ok).toBe(false);
  });

  it("lets the bundled Node.js runtime keep its maker's signature, and no other file", () => {
    const node = { signer: "CN=OpenJS Foundation, O=OpenJS Foundation, L=San Francisco, S=California, C=US" };
    expect(judgeSignatures([signed("fitron-node-x86_64-pc-windows-msvc.exe", node)], { require: true, publisher: "FITRON" }).ok).toBe(true);
    expect(judgeSignatures([signed("fitron.exe", node)], { require: true, publisher: "FITRON" }).ok).toBe(false);
  });

  it("reports a development build as unsigned without failing it, and says what Windows will show", () => {
    const v = judgeSignatures([signed("setup.exe", { status: "NotSigned", signer: null, timestamper: null })], { require: false, publisher: "FITRON" });
    expect(v.ok).toBe(true);
    expect(v.lines.join("\n")).toMatch(/Unknown publisher/);
  });

  it("fails even a report when Windows gave no status: the check itself did not run", () => {
    const v = judgeSignatures([signed("setup.exe", { status: "", signer: null, timestamper: null })], { require: false, publisher: "FITRON" });
    expect(v.ok).toBe(false);
    expect(v.lines[0]).toMatch(/^✗ setup\.exe: Windows reported no signature status/);
  });
});
