import { inflateRawSync } from "node:zlib";
import { expect } from "vitest";
import { crc32 } from "@/lib/xlsx";

// A zip reader written for the tests (it reads the central directory, as Excel does), so the writer is checked against
// something other than itself. Returns each part's name and its text.
export function unzip(buf: Uint8Array): Record<string, string> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = buf.length - 22;
  while (eocd >= 0 && dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
  expect(eocd, "end-of-central-directory record").toBeGreaterThanOrEqual(0);
  const count = dv.getUint16(eocd + 10, true);
  let at = dv.getUint32(eocd + 16, true);
  const out: Record<string, string> = {};
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    expect(dv.getUint32(at, true)).toBe(0x02014b50);
    const method = dv.getUint16(at + 10, true);
    const crc = dv.getUint32(at + 16, true);
    const csize = dv.getUint32(at + 20, true);
    const usize = dv.getUint32(at + 24, true);
    const nameLen = dv.getUint16(at + 28, true);
    const local = dv.getUint32(at + 42, true);
    const name = dec.decode(buf.subarray(at + 46, at + 46 + nameLen));
    // the local header repeats the name and says where the data starts
    expect(dv.getUint32(local, true)).toBe(0x04034b50);
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    expect(method).toBe(8);
    const raw = inflateRawSync(buf.subarray(start, start + csize));
    expect(raw.length, `${name} size`).toBe(usize);
    expect(crc32(raw), `${name} checksum`).toBe(crc);
    out[name] = dec.decode(raw);
    at += 46 + nameLen;
  }
  return out;
}
