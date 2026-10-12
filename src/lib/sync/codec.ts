import { SYNC_ENTITY } from "./entities";
import { SYNC_MODEL } from "./model.generated";
import type { FieldMeta } from "./meta";

// Cloud sync: one record on the wire, and the conversions to and from it. On the wire every value is plain JSON with one
// spelling per type, whichever database it came from:
//   DateTime  ISO-8601 in UTC ("2026-10-11T06:30:00.000Z"); calendar dates are midnight UTC, as the services keep them
//   Decimal   a decimal string ("18", "2.5"): tax rates and measurements only, never money
//   BigInt    a decimal string
//   Bytes     {"$bytes": base64}
//   Boolean   true or false
//   lists     arrays; Json as the JSON value
// Money is Int paise on both sides and on the wire; a value that is not a whole number is refused, never rounded.

export type WireRow = Record<string, unknown>;

export class SyncDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncDataError";
  }
}

const meta = (entity: string) => {
  const m = SYNC_MODEL[entity];
  if (!m) throw new SyncDataError(`${entity} is not a synced record.`);
  return m;
};

/** The record's key as one string (composite keys joined by "|"), as the triggers write it. */
export function keyOf(entity: string, row: WireRow): string {
  return meta(entity)
    .pk.map((k) => String(row[k] ?? ""))
    .join("|");
}

/** The record's key fields from its key string. */
export function keyFields(entity: string, entityId: string): Record<string, string> {
  const pk = meta(entity).pk;
  const parts = pk.length === 1 ? [entityId] : entityId.split("|");
  if (parts.length !== pk.length || parts.some((p) => !p)) throw new SyncDataError(`Bad key for ${entity}: ${entityId}`);
  return Object.fromEntries(pk.map((k, i) => [k, parts[i]!]));
}

/** Prisma's unique-where for the record's key: { id } or { userId_branchId: { userId, branchId } }. */
export function keyWhere(entity: string, entityId: string): Record<string, unknown> {
  const pk = meta(entity).pk;
  const fields = keyFields(entity, entityId);
  return pk.length === 1 ? fields : { [pk.join("_")]: fields };
}

const toIso = (v: unknown): string => {
  const d = v instanceof Date ? v : new Date(String(/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? `${v}T00:00:00Z` : v));
  if (Number.isNaN(d.getTime())) throw new SyncDataError(`Not a date: ${String(v)}`);
  return d.toISOString();
};

/** PostgreSQL's to_jsonb spells bytea as "\\x0a0b…". */
const bytesToBase64 = (v: unknown): string => {
  if (v instanceof Uint8Array) return Buffer.from(v).toString("base64");
  if (typeof v === "string" && v.startsWith("\\x")) return Buffer.from(v.slice(2), "hex").toString("base64");
  if (typeof v === "object" && v && typeof (v as { $bytes?: unknown }).$bytes === "string") return (v as { $bytes: string }).$bytes;
  throw new SyncDataError("Not bytes");
};

function fieldToWire(f: FieldMeta, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (f.list) {
    const arr = typeof v === "string" ? (JSON.parse(v) as unknown[]) : (v as unknown[]);
    if (!Array.isArray(arr)) throw new SyncDataError("Not a list");
    return arr.map((x) => fieldToWire({ ...f, list: undefined }, x));
  }
  switch (f.t) {
    case "DateTime":
      return toIso(v);
    case "Decimal":
      return String(Number(typeof v === "object" ? String(v) : v));
    case "BigInt":
      return String(v);
    case "Bytes":
      return { $bytes: bytesToBase64(v) };
    case "Boolean":
      return v === true || v === 1 || v === "1" || v === "true";
    case "Int":
    case "Float":
      return typeof v === "bigint" ? Number(v) : Number(v);
    case "Json":
      return typeof v === "string" ? safeJson(v) : v;
    default:
      return v;
  }
}

const safeJson = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

/**
 * A row as read from either database (a Prisma row, or PostgreSQL's to_jsonb of it) on the wire: only the table's own
 * fields, none of the fields that never sync.
 */
export function toWire(entity: string, row: Record<string, unknown>): WireRow {
  const m = meta(entity);
  const omit = new Set(SYNC_ENTITY.get(entity)?.omit ?? []);
  const out: WireRow = {};
  for (const [name, f] of Object.entries(m.fields)) {
    if (omit.has(name) || !(name in row)) continue;
    out[name] = fieldToWire(f, row[name]);
  }
  return out;
}

function fieldFromWire(entity: string, name: string, f: FieldMeta, v: unknown): unknown {
  const bad = (what: string) => new SyncDataError(`${entity}.${name}: ${what}`);
  if (v === null || v === undefined) {
    if (!f.opt && !f.list && f.t !== "Json") throw bad("is required");
    return null;
  }
  if (f.list) {
    if (!Array.isArray(v)) throw bad("must be a list");
    return v.map((x) => fieldFromWire(entity, name, { ...f, list: undefined, opt: undefined }, x));
  }
  switch (f.t) {
    case "String":
      if (typeof v !== "string") throw bad("must be text");
      return v;
    case "Int":
      if (typeof v !== "number" || !Number.isSafeInteger(v)) throw bad("must be a whole number");
      return v;
    case "Float":
      if (typeof v !== "number" || !Number.isFinite(v)) throw bad("must be a number");
      return v;
    case "BigInt":
      if (typeof v !== "string" || !/^-?\d+$/.test(v)) throw bad("must be a whole number");
      return BigInt(v);
    case "Decimal":
      if (typeof v !== "string" || !/^-?\d+(\.\d+)?$/.test(v)) throw bad("must be a decimal");
      return v;
    case "Boolean":
      if (typeof v !== "boolean") throw bad("must be true or false");
      return v;
    case "DateTime": {
      if (typeof v !== "string") throw bad("must be a date");
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) throw bad("must be a date");
      return d;
    }
    case "Bytes":
      return new Uint8Array(Buffer.from(bytesToBase64(v), "base64"));
    case "Json":
      return v;
  }
}

/**
 * A wire row as Prisma data for an upsert: only the table's fields, each checked for its type (a whole number of paise
 * stays a whole number), the fields that never sync left out. Unknown fields are refused, so a newer computer cannot
 * write a column this server does not have.
 */
export function fromWire(entity: string, wire: WireRow): Record<string, unknown> {
  const m = meta(entity);
  const omit = new Set(SYNC_ENTITY.get(entity)?.omit ?? []);
  for (const k of Object.keys(wire)) if (!m.fields[k] && !k.startsWith("$")) throw new SyncDataError(`${entity}.${k}: no such field`);
  const out: Record<string, unknown> = {};
  for (const [name, f] of Object.entries(m.fields)) {
    if (omit.has(name) || !(name in wire)) continue;
    out[name] = fieldFromWire(entity, name, f, wire[name]);
  }
  return out;
}

/** The same value on the wire, compared as JSON (key order of Json values aside). */
export function sameValue(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}

function stable(v: unknown): string {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  return `{${Object.keys(v as object)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}

/** The fields whose values differ between two wire rows of the same table. */
export function changedFields(entity: string, a: WireRow | null, b: WireRow | null): string[] {
  const names = Object.keys(meta(entity).fields).filter((n) => !(SYNC_ENTITY.get(entity)?.omit ?? []).includes(n));
  return names.filter((n) => !sameValue(a?.[n] ?? null, b?.[n] ?? null));
}
