import { randomUUID } from "node:crypto";

// An in-memory Prisma look-alike covering the query shapes the services use (equality, in, not, gte/lt/lte, nested
// relation filter on gym.status, compound unique keys, orderBy, take/skip/cursor). Enough to run the whole API and the
// worker without Postgres. Set `failing = true` to simulate an outage: every call then rejects like Prisma does.

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

class PrismaError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const now = () => new Date();

function matchValue(actual: unknown, cond: unknown): boolean {
  if (cond === null || cond === undefined || typeof cond !== "object" || cond instanceof Date) return actual === cond || (actual instanceof Date && cond instanceof Date && actual.getTime() === cond.getTime());
  const c = cond as Record<string, unknown>;
  if ("in" in c) return (c.in as unknown[]).includes(actual);
  if ("not" in c) return !matchValue(actual, c.not);
  if ("gte" in c && !(actual !== null && actual !== undefined && (actual as number | Date) >= (c.gte as number | Date))) return false;
  if ("gt" in c && !(actual !== null && actual !== undefined && (actual as number | Date) > (c.gt as number | Date))) return false;
  if ("lte" in c && !(actual !== null && actual !== undefined && (actual as number | Date) <= (c.lte as number | Date))) return false;
  if ("lt" in c && !(actual !== null && actual !== undefined && (actual as number | Date) < (c.lt as number | Date))) return false;
  return true;
}

class Table {
  rows: Row[] = [];
  constructor(
    readonly name: string,
    private readonly db: FakeDb,
    private readonly uniques: string[][],
    private readonly defaults: () => Row,
  ) {}

  private fail() {
    if (this.db.failing) throw new PrismaError("P1001", "Can't reach database server");
  }

  private matches(row: Row, where: Where): boolean {
    for (const [k, v] of Object.entries(where)) {
      if (k === "gym" && typeof v === "object" && v) {
        const gym = this.db.gym.rows.find((g) => g.id === row.gymId);
        if (!gym || !this.matches(gym, v as Where)) return false;
        continue;
      }
      if (k.includes("_") && typeof v === "object" && v && !("in" in (v as object))) {
        // compound unique: { gymId_phoneNumber: { gymId, phoneNumber } }
        if (!this.matches(row, v as Where)) return false;
        continue;
      }
      if (!matchValue(row[k], v)) return false;
    }
    return true;
  }

  private checkUnique(row: Row, excludeId?: string) {
    for (const u of this.uniques) {
      if (u.some((f) => row[f] === null || row[f] === undefined)) continue;
      const clash = this.rows.find((r) => r.id !== excludeId && u.every((f) => r[f] === row[f]));
      if (clash) throw new PrismaError("P2002", `Unique constraint failed on the fields: (${u.join(",")})`);
    }
  }

  private sort(rows: Row[], orderBy?: Row | Row[]): Row[] {
    if (!orderBy) return rows;
    const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o) => Object.entries(o));
    return [...rows].sort((a, b) => {
      for (const [k, dir] of keys) {
        const av = a[k] as number | string | Date;
        const bv = b[k] as number | string | Date;
        if (av === bv) continue;
        const cmp = av < bv ? -1 : 1;
        return dir === "desc" ? -cmp : cmp;
      }
      return 0;
    });
  }

  async findMany(args: { where?: Where; orderBy?: Row | Row[]; take?: number; skip?: number; cursor?: { id: string }; select?: Row } = {}): Promise<Row[]> {
    this.fail();
    let rows = this.sort(
      this.rows.filter((r) => this.matches(r, args.where ?? {})),
      args.orderBy,
    );
    if (args.cursor) {
      const i = rows.findIndex((r) => r.id === args.cursor!.id);
      rows = i >= 0 ? rows.slice(i) : [];
    }
    if (args.skip) rows = rows.slice(args.skip);
    if (args.take !== undefined) rows = rows.slice(0, args.take);
    return rows.map((r) => ({ ...r }));
  }
  async findFirst(args: { where?: Where; orderBy?: Row | Row[] } = {}): Promise<Row | null> {
    return (await this.findMany({ ...args, take: 1 }))[0] ?? null;
  }
  async findUnique(args: { where: Where }): Promise<Row | null> {
    return this.findFirst(args);
  }
  async count(args: { where?: Where } = {}): Promise<number> {
    return (await this.findMany(args)).length;
  }
  async create(args: { data: Row }): Promise<Row> {
    this.fail();
    const { session, ...data } = args.data as Row & { session?: { create: Row } };
    const row: Row = { id: randomUUID(), createdAt: now(), updatedAt: now(), ...this.defaults(), ...data };
    this.checkUnique(row);
    this.rows.push(row);
    if (session?.create) await this.db.whatsAppSession.create({ data: { ...session.create, gymId: row.id } });
    return { ...row };
  }
  async createMany(args: { data: Row[] }): Promise<{ count: number }> {
    for (const d of args.data) await this.create({ data: d });
    return { count: args.data.length };
  }
  private applyUpdate(row: Row, data: Row) {
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === "object" && "increment" in (v as object)) row[k] = ((row[k] as number) ?? 0) + ((v as { increment: number }).increment ?? 0);
      else row[k] = v;
    }
    row.updatedAt = now();
  }
  async update(args: { where: Where; data: Row }): Promise<Row> {
    this.fail();
    const row = this.rows.find((r) => this.matches(r, args.where));
    if (!row) throw new PrismaError("P2025", "Record to update not found.");
    const next = { ...row };
    this.applyUpdate(next, args.data);
    this.checkUnique(next, row.id as string);
    Object.assign(row, next);
    return { ...row };
  }
  async updateMany(args: { where: Where; data: Row }): Promise<{ count: number }> {
    this.fail();
    let n = 0;
    for (const r of this.rows) {
      if (!this.matches(r, args.where)) continue;
      this.applyUpdate(r, args.data);
      n++;
    }
    return { count: n };
  }
  async upsert(args: { where: Where; create: Row; update: Row }): Promise<Row> {
    const existing = await this.findFirst({ where: args.where });
    return existing ? this.update({ where: { id: existing.id }, data: args.update }) : this.create({ data: args.create });
  }
  async delete(args: { where: Where }): Promise<Row> {
    this.fail();
    const i = this.rows.findIndex((r) => this.matches(r, args.where));
    if (i < 0) throw new PrismaError("P2025", "Record to delete does not exist.");
    return this.rows.splice(i, 1)[0]!;
  }
  async deleteMany(args: { where: Where }): Promise<{ count: number }> {
    this.fail();
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !this.matches(r, args.where));
    return { count: before - this.rows.length };
  }
}

export class FakeDb {
  failing = false;
  readonly gym = new Table("gym", this, [["externalId"], ["apiKeyHash"]], () => ({ status: "ACTIVE", externalId: null, phone: null, timezone: "Asia/Kolkata" }));
  readonly whatsAppSession = new Table("whatsAppSession", this, [["gymId"]], () => ({ status: "DISCONNECTED", phoneNumber: null, sessionLocation: null, lastError: null, connectedAt: null, lastSeenAt: null }));
  readonly message = new Table("message", this, [["gymId", "idempotencyKey"]], () => ({ messageType: "TEXT", category: "TRANSACTIONAL", status: "QUEUED", memberId: null, templateKey: null, idempotencyKey: null, mediaPath: null, mediaName: null, mediaMimeType: null, providerMessageId: null, error: null, attempts: 0, queuedAt: now(), processingAt: null, sentAt: null, deliveredAt: null, readAt: null, failedAt: null }));
  readonly consent = new Table("consent", this, [["gymId", "phoneNumber"]], () => ({ memberId: null, whatsappOptIn: false, optInSource: null, optInAt: null, optOutSource: null, optOutAt: null }));
  readonly template = new Table("template", this, [["gymId", "name"]], () => ({ category: "TRANSACTIONAL", active: true }));

  async $queryRaw(): Promise<unknown[]> {
    if (this.failing) throw new PrismaError("P1001", "Can't reach database server");
    return [{ "?column?": 1 }];
  }
  async $disconnect(): Promise<void> {}
  async $transaction<T>(fn: (tx: FakeDb) => Promise<T>): Promise<T> {
    return fn(this);
  }
}
