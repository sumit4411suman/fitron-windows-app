import "server-only";
import { createHash, createHmac } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// Private file storage. With S3_* set it uses any S3-compatible bucket (AWS S3, Cloudflare R2,
// DigitalOcean Spaces, MinIO); otherwise files go to a folder on the server (STORAGE_DIR, default
// ./storage), which must be on a persistent disk. Objects are never public: the app reads them back
// itself after a permission check.

const env = (k: string) => process.env[k]?.trim() || "";

export type S3Config = { endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string };

function s3Config(): S3Config | null {
  const c = { endpoint: env("S3_ENDPOINT"), bucket: env("S3_BUCKET"), region: env("S3_REGION") || "auto", accessKeyId: env("S3_ACCESS_KEY_ID"), secretAccessKey: env("S3_SECRET_ACCESS_KEY") };
  return c.endpoint && c.bucket && c.accessKeyId && c.secretAccessKey ? c : null;
}

export const storageMode = () => (s3Config() ? "S3" : "DISK");

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

async function s3(c: S3Config, method: "PUT" | "GET" | "DELETE", key: string, body?: Uint8Array, contentType?: string) {
  const url = new URL(`${c.endpoint.replace(/\/$/, "")}/${c.bucket}/${key.split("/").map(enc).join("/")}`);
  const payloadHash = sha256(body ?? "");
  const headers = signV4({ method, url, headers: contentType ? { "content-type": contentType } : {}, payloadHash, region: c.region, accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, now: new Date() });
  delete (headers as Record<string, string>).host;
  const res = await fetch(url, { method, headers, body: body ? Buffer.from(body) : undefined, signal: AbortSignal.timeout(30_000) });
  if (!res.ok && !(method === "DELETE" && res.status === 404)) throw new Error(`Storage ${method} failed: ${res.status}`);
  return res;
}

// The folder is only known at run time (STORAGE_DIR) and is only used on a server with a disk. The ignore comments tell the
// bundler so: without them it warns, and treats every file in the project as one this code might read, so on Vercel each
// function would carry the whole project.
const diskPath = (key: string) => {
  const root = path.resolve(/*turbopackIgnore: true*/ env("STORAGE_DIR") || "storage");
  const p = path.resolve(root, key);
  if (!p.startsWith(root + path.sep)) throw new Error("Bad storage key");
  return p;
};

export async function putObject(key: string, body: Uint8Array, contentType: string) {
  const c = s3Config();
  if (c) return void (await s3(c, "PUT", key, body, contentType));
  const p = diskPath(key);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, body);
}

export async function getObject(key: string): Promise<Uint8Array> {
  const c = s3Config();
  if (c) return new Uint8Array(await (await s3(c, "GET", key)).arrayBuffer());
  return readFile(/*turbopackIgnore: true*/ diskPath(key));
}

export async function deleteObject(key: string) {
  const c = s3Config();
  if (c) return void (await s3(c, "DELETE", key));
  await rm(diskPath(key), { force: true });
}

/** What the bytes actually are, whatever the file name says. Only these types are accepted. */
export function sniffType(b: Uint8Array): { mime: string; ext: string } | null {
  const hex = Buffer.from(b.subarray(0, 12)).toString("hex");
  if (hex.startsWith("25504446")) return { mime: "application/pdf", ext: "pdf" };
  if (hex.startsWith("ffd8ff")) return { mime: "image/jpeg", ext: "jpg" };
  if (hex.startsWith("89504e470d0a1a0a")) return { mime: "image/png", ext: "png" };
  if (hex.startsWith("52494646") && hex.slice(16, 24) === "57454250") return { mime: "image/webp", ext: "webp" };
  if (hex.slice(8, 16) === "66747970" && /^(68656963|68656978|6d696631|6d736631)/.test(hex.slice(16, 24))) return { mime: "image/heic", ext: "heic" };
  return null;
}
