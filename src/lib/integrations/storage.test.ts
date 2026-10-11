import { afterEach, describe, expect, it } from "vitest";
import { isLocal } from "@/lib/runtime/edition";
import { signV4, sniffType, storageDetail, storageMode, storageProblem } from "./storage";

const S3 = ["S3_ENDPOINT", "S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "VERCEL"];
const saved = Object.fromEntries(S3.map((k) => [k, process.env[k]]));
const setEnv = (v: Record<string, string>) => {
  for (const k of S3) delete process.env[k];
  Object.assign(process.env, v);
};

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

  // Server storage settings are the Cloud Edition's: the Local Edition's files always go to the data folder.
  describe.skipIf(isLocal())("storageProblem", () => {
    afterEach(() => {
      for (const k of S3) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k]!;
      }
    });

    it("is quiet when a bucket is fully set up or a disk server has no S3 at all", () => {
      setEnv({ S3_ENDPOINT: "https://x", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s" });
      expect(storageProblem()).toBeNull();
      setEnv({});
      expect(storageProblem()).toBeNull();
    });

    it("tells the gym in plain words when the bucket is half set up, without the server's setting names", () => {
      setEnv({ S3_ENDPOINT: "https://x", S3_BUCKET: "b" });
      const p = storageProblem();
      expect(p).toContain("can't be saved");
      expect(p).not.toMatch(/S3_|ACCESS_KEY|SECRET/);
      expect(storageDetail(), "the host still learns which keys are missing").toContain("S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY missing");
    });

    it("keeps files in the database on Vercel without a bucket, so nothing is blocked", () => {
      setEnv({ VERCEL: "1" });
      expect(storageMode()).toBe("DATABASE");
      expect(storageProblem()).toBeNull();
      setEnv({ VERCEL: "1", S3_ENDPOINT: "https://x", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s" });
      expect(storageMode()).toBe("S3");
    });
  });
});
