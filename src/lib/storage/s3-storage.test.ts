import { describe, expect, it } from "vitest";
import { parseListing } from "./s3-storage";

describe("S3 listing (Cloud Edition)", () => {
  it("reads keys, sizes and the next page from a ListObjectsV2 reply", () => {
    const xml = `<?xml version="1.0"?><ListBucketResult><IsTruncated>true</IsTruncated>
      <Contents><Key>org1/members/m1/a.pdf</Key><LastModified>2026-10-01T10:00:00.000Z</LastModified><Size>1200</Size></Contents>
      <Contents><Key>org1/gym/logo&amp;1.png</Key><LastModified>2026-10-02T10:00:00.000Z</LastModified><Size>34</Size></Contents>
      <NextContinuationToken>tok123</NextContinuationToken></ListBucketResult>`;
    const r = parseListing(xml);
    expect(r.items.map((i) => [i.key, i.size])).toEqual([["org1/members/m1/a.pdf", 1200], ["org1/gym/logo&1.png", 34]]);
    expect(r.next).toBe("tok123");
    expect(parseListing("<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>")).toEqual({ items: [], next: null });
  });
});
