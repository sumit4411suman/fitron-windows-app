import { Prisma } from "@/generated/prisma/client";
import { fromWire, keyFields, keyWhere, SyncDataError, toWire, type WireRow } from "./codec";
import { SYNC_ENTITY } from "./entities";
import { SYNC_MODEL } from "./model.generated";

// Cloud sync: reading and writing one synced record through Prisma, the same way on both sides (fitron.in's PostgreSQL
// and the computer's SQLite). A staff member's role travels by name, because each database seeds its own catalogue of
// roles; a staff member who arrives from the other side cannot sign in here until a Super Admin sets their password
// (passwords never sync).

type Client = Prisma.TransactionClient;
type Delegate = {
  findUnique(a: unknown): Promise<Record<string, unknown> | null>;
  findMany(a: unknown): Promise<Record<string, unknown>[]>;
  upsert(a: unknown): Promise<unknown>;
  deleteMany(a: unknown): Promise<{ count: number }>;
};

/** A password hash nothing matches: the person signs in only once a password is set on this side. */
export const NO_PASSWORD = "!sync";

const delegate = (c: Client, entity: string) => {
  const d = (c as unknown as Record<string, Delegate>)[entity[0]!.toLowerCase() + entity.slice(1)];
  if (!d) throw new SyncDataError(`${entity} has no table here.`);
  return d;
};

const roleNames = new WeakMap<object, Map<string, string>>();
async function roles(c: Client): Promise<Map<string, string>> {
  const hit = roleNames.get(c as object);
  if (hit) return hit;
  // id → name and "name:<name>" → id in one map.
  const rows = await c.role.findMany({ select: { id: true, name: true } });
  const m = new Map<string, string>();
  for (const r of rows) {
    m.set(r.id, r.name);
    m.set(`name:${r.name}`, r.id);
  }
  roleNames.set(c as object, m);
  return m;
}

/** A row read through Prisma, on the wire. */
export async function rowToWire(c: Client, entity: string, row: Record<string, unknown>): Promise<WireRow> {
  const wire = toWire(entity, row);
  if (entity === "User") {
    const name = (await roles(c)).get(String(row.roleId));
    delete wire.roleId;
    wire.$role = name ?? null;
  }
  return wire;
}

export async function readRecord(c: Client, entity: string, entityId: string): Promise<WireRow | null> {
  const row = await delegate(c, entity).findUnique({ where: keyWhere(entity, entityId) });
  return row ? rowToWire(c, entity, row) : null;
}

/**
 * Writes the record as the wire row says (insert or update), or removes it (null). The caller has checked the gym and
 * the rules; this only stores.
 */
export async function writeRecord(c: Client, entity: string, entityId: string, wire: WireRow | null): Promise<void> {
  const where = keyWhere(entity, entityId);
  const d = delegate(c, entity);
  if (!wire) {
    await d.deleteMany({ where: keyFields(entity, entityId) });
    return;
  }
  const data = fromWire(entity, wire);
  for (const [k, v] of Object.entries(data)) if (v === null && SYNC_MODEL[entity]!.fields[k]?.t === "Json") data[k] = Prisma.DbNull;
  let create = data;
  if (entity === "User") {
    const name = typeof wire.$role === "string" ? wire.$role : null;
    const roleId = name ? (await roles(c)).get(`name:${name}`) : undefined;
    if (!roleId) throw new SyncDataError(`User ${entityId}: no role named ${JSON.stringify(name)} here.`);
    data.roleId = roleId;
    create = { ...data, passwordHash: NO_PASSWORD };
  }
  const update = { ...data };
  for (const k of SYNC_MODEL[entity]!.pk) delete update[k];
  await d.upsert({ where, create, update });
}

/** One gym's records of a table, in key order, a page at a time: `after` is the last key of the previous page. */
export async function readPage(c: Client, entity: string, orgId: string, after: string | null, limit: number): Promise<{ rows: WireRow[]; last: string | null }> {
  const spec = SYNC_ENTITY.get(entity)!;
  const pk = SYNC_MODEL[entity]!.pk;
  const where: Record<string, unknown> = { ...spec.orgWhere(orgId) };
  if (spec.skipKeys) where.key = { notIn: spec.skipKeys };
  const d = delegate(c, entity);
  let rows: Record<string, unknown>[];
  if (pk.length === 1) {
    rows = await d.findMany({ where: after ? { ...where, [pk[0]!]: { gt: after } } : where, orderBy: { [pk[0]!]: "asc" }, take: limit });
  } else {
    // Composite keys: small tables (branch access, settings, month locks, plan prices); `after` counts rows.
    const skip = after ? Number(after) : 0;
    rows = await d.findMany({ where, orderBy: pk.map((k) => ({ [k]: "asc" })), skip, take: limit });
    const wires = await Promise.all(rows.map((r) => rowToWire(c, entity, r)));
    return { rows: wires, last: rows.length === limit ? String(skip + rows.length) : null };
  }
  const wires = await Promise.all(rows.map((r) => rowToWire(c, entity, r)));
  return { rows: wires, last: rows.length === limit ? String(rows[rows.length - 1]![pk[0]!]) : null };
}
