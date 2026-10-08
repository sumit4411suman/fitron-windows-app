import { describe, expect, it } from "vitest";
import { signV4, sniffType } from "./storage";

describe("storage", () => {
  it("signs S3 requests exactly as AWS's published example", () => {
    const h = signV4({
      method: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
      headers: { range: "bytes=0-9" },
      payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      region: "us-east-1",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      now: new Date("2013-05-24T00:00:00Z"),
    });
    expect(h.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });

  it("recognises files by their bytes, not their names", () => {
    expect(sniffType(Buffer.from("%PDF-1.7\n"))?.mime).toBe("application/pdf");
    expect(sniffType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))?.mime).toBe("image/jpeg");
    expect(sniffType(Buffer.from("<html><script>"))).toBeNull();
  });
});
