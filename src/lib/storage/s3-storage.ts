import { createHash, createHmac } from "node:crypto";
import { FileMissingError, assertValidKey, type FileStorage, type StoredFileInfo } from "./file-storage";

// Private files in any S3-compatible bucket (AWS S3, Cloudflare R2, DigitalOcean Spaces, MinIO, Supabase Storage), signed
// with AWS Signature Version 4 by hand, so no SDK is needed. Cloud Edition only: the Local Edition never uses a bucket.

export type S3Config = { endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string };

const sha256 = (b: string | Uint8Array) => createHash("sha256").update(b).digest("hex");
const hmac = (k: Buffer | string, s: string) => createHmac("sha256", k).update(s).digest();
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** AWS Signature Version 4 headers for one request (path-style URL). Exported for its test. */
export function signV4(a: { method: string; url: URL; headers: Record<string, string>; payloadHash: string; region: string; accessKeyId: string; secretAccessKey: string; now: Date }) {
  const amzDate = a.now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = { ...a.headers, host: a.url.host, "x-amz-content-sha256": a.payloadHash, "x-amz-date": amzDate };
  const names = Object.keys(headers)
    .map((h) => h.toLowerCase())
    .sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const canonicalHeaders = names.map((h) => `${h}:${lower[h]}\n`).join("");
  const signedHeaders = names.join(";");
  const query = [...a.url.searchParams.entries()]
    .map(([k, v]) => `${enc(k)}=${enc(v)}`)
    .sort()
    .join("&");
  const canonicalPath = a.url.pathname.split("/").map((p) => enc(decodeURIComponent(p))).join("/");
  const canonical = [a.method, canonicalPath, query, canonicalHeaders, signedHeaders, a.payloadHash].join("\n");
  const scope = `${day}/${a.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${a.secretAccessKey}`, day), a.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${a.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` };
}

async function s3(c: S3Config, method: "PUT" | "GET" | "DELETE", key: string, body?: Uint8Array, contentType?: string, query = "") {
  const url = new URL(`${c.endpoint.replace(/\/$/, "")}/${c.bucket}/${key.split("/").map(enc).join("/")}${query}`);
  const payloadHash = sha256(body ?? "");
  const headers = signV4({ method, url, headers: contentType ? { "content-type": contentType } : {}, payloadHash, region: c.region, accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, now: new Date() });
  delete (headers as Record<string, string>).host;
  const res = await fetch(url, { method, headers, body: body ? Buffer.from(body) : undefined, signal: AbortSignal.timeout(30_000) });
  if (method === "GET" && res.status === 404 && key) throw new FileMissingError(key);
  if (!res.ok && !(method === "DELETE" && res.status === 404)) throw new Error(`Storage ${method} failed: ${res.status}`);
  return res;
}


/** Reads the keys and sizes out of a ListObjectsV2 reply. Exported for its test. */
export function parseListing(xml: string): { items: StoredFileInfo[]; next: string | null } {
  const items = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((m) => {
    const tag = (t: string) => m[1]!.match(new RegExp(`<${t}>([^<]*)</${t}>`))?.[1] ?? "";
    const unxml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
    return { key: unxml(tag("Key")), size: Number(tag("Size")) || 0, modifiedAt: new Date(tag("LastModified")) };
  });
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
  const next = truncated ? (xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/)?.[1] ?? null) : null;
  return { items, next };
}

export class S3FileStorage implements FileStorage {
  readonly mode = "S3" as const;
  constructor(private readonly c: S3Config) {}

  async put(key: string, body: Uint8Array, contentType: string) {
    assertValidKey(key);
    await s3(this.c, "PUT", key, body, contentType);
  }

  async get(key: string) {
    assertValidKey(key);
    return new Uint8Array(await (await s3(this.c, "GET", key)).arrayBuffer());
  }

  async delete(key: string) {
    assertValidKey(key);
    await s3(this.c, "DELETE", key);
  }

  async stat(key: string): Promise<StoredFileInfo | null> {
    const dir = key.includes("/") ? key.slice(0, key.lastIndexOf("/") + 1) : "";
    return (await this.list(dir)).find((f) => f.key === key) ?? null;
  }

  async list(prefix: string): Promise<StoredFileInfo[]> {
    const out: StoredFileInfo[] = [];
    let token: string | null = null;
    do {
      const q = new URLSearchParams({ "list-type": "2", prefix, ...(token ? { "continuation-token": token } : {}) });
      const page = parseListing(await (await s3(this.c, "GET", "", undefined, undefined, `?${q}`)).text());
      out.push(...page.items);
      token = page.next;
    } while (token);
    return out;
  }
}
