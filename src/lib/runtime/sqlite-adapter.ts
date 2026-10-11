import { mkdirSync } from "node:fs";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import type { SqlDriverAdapter, SqlMigrationAwareDriverAdapterFactory, SqlQuery, SqlResultSet, Transaction } from "@prisma/driver-adapter-utils";

// The Local Edition's database driver: better-sqlite3 through Prisma's adapter, arranged so SQLite behaves like the
// PostgreSQL the services were written for.
//
// 1. Connection settings, run before the first query: foreign keys on (SQLite leaves them off by default), WAL journal
//    (readers never block the writer, and a crash leaves a consistent file), synchronous=FULL (a committed payment is on
//    disk before the app says so, even if the power goes), and a busy timeout for the backup tool's short locks.
//
// 2. Two connections. better-sqlite3 is one connection per handle, and SQLite has one writer at a time.
//    - The WRITER runs transactions and every statement that changes data, one at a time, in arrival order. A statement
//      that arrives while a transaction is open waits its turn (it would otherwise run inside that transaction on the
//      same handle and be committed or rolled back with it).
//    - The READER answers plain SELECTs outside transactions. In WAL mode it sees the last committed state, never a
//      half-written sale, and never waits for the writer: the same isolation PostgreSQL gives a second connection.
//      A page rendering during a restore reads the data as it was before the restore began.
//    A write that waits longer than WRITE_WAIT_MS fails with a clear message instead of hanging: that only happens when
//    code inside a transaction writes through `db` instead of `tx`, a bug that PostgreSQL would also expose (as a lock
//    wait) and that the tests catch.

export const SQLITE_PRAGMAS = ["PRAGMA foreign_keys = ON", "PRAGMA journal_mode = WAL", "PRAGMA synchronous = FULL", "PRAGMA busy_timeout = 5000", "PRAGMA temp_store = MEMORY"];
export const WRITE_WAIT_MS = 30_000;
const CLEAR_GUARD: SqlQuery = { sql: 'DELETE FROM "_fitron_guard"', args: [], argTypes: [] };

export class DatabaseBusyError extends Error {
  constructor() {
    super("The FITRON database is busy with another change. Try again in a moment.");
    this.name = "DatabaseBusyError";
  }
}

class Lock {
  #tail: Promise<void> = Promise.resolve();
  /** Resolves with a release function when it is this caller's turn. With a timeout, gives up (and skips its turn). */
  acquire(timeoutMs?: number): Promise<() => void> {
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    const prev = this.#tail;
    this.#tail = prev.then(() => mine);
    if (!timeoutMs) return prev.then(() => release);
    return new Promise((resolve, reject) => {
      let timedOut = false;
      const t = setTimeout(() => {
        timedOut = true;
        reject(new DatabaseBusyError());
      }, timeoutMs);
      void prev.then(() => {
        clearTimeout(t);
        if (timedOut) release(); // pass the turn on untouched
        else resolve(release);
      });
    });
  }
}

/** Plain reads, outside a transaction, go to the reader. Anything else (INSERT … RETURNING included) is a write. */
export const isPlainRead = (sql: string) => /^\s*(SELECT|WITH|PRAGMA\s+\w+\s*$|EXPLAIN)\b/i.test(sql) && !/\b(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql.replace(/'[^']*'/g, ""));

class SerialisedTransaction implements Transaction {
  constructor(private readonly inner: Transaction, private readonly release: () => void) {}
  get provider() { return this.inner.provider; }
  get adapterName() { return this.inner.adapterName; }
  get options() { return this.inner.options; }
  queryRaw(q: SqlQuery) { return this.inner.queryRaw(q); }
  executeRaw(q: SqlQuery) { return this.inner.executeRaw(q); }
  async commit() {
    try {
      // The financial-row guard's permission (src/lib/services/db-guard.ts) lasts for one transaction, as PostgreSQL's
      // set_config(..., true) does: cleared here, inside the transaction, so it can never be committed.
      await this.inner.executeRaw(CLEAR_GUARD);
      await this.inner.commit();
    } finally {
      this.release();
    }
  }
  async rollback() { try { await this.inner.rollback(); } finally { this.release(); } }
}

// Every open Local adapter in this process (Next.js may load more than one copy of the database client), so a restore
// can make them all reconnect (reopenLocalConnections).
const g = globalThis as unknown as { fitronAdapters?: Set<LocalAdapter> };
const adapters = (g.fitronAdapters ??= new Set());

/**
 * Closes and reopens every database connection of this process, waiting for work in progress to finish first. Called
 * after a restore, so nothing can go on serving what was there before it: the brief's "reload the application", done
 * without restarting.
 */
export async function reopenLocalConnections(): Promise<number> {
  for (const a of adapters) await a.reopen();
  return adapters.size;
}

class LocalAdapter implements SqlDriverAdapter {
  readonly #lock = new Lock();
  constructor(
    private writer: SqlDriverAdapter,
    private reader: SqlDriverAdapter,
    private readonly open: () => Promise<{ writer: SqlDriverAdapter; reader: SqlDriverAdapter }>,
  ) {
    adapters.add(this);
  }

  async reopen() {
    const release = await this.#lock.acquire();
    try {
      const old = { writer: this.writer, reader: this.reader };
      const fresh = await this.open();
      this.writer = fresh.writer;
      this.reader = fresh.reader;
      if (old.reader !== old.writer) await old.reader.dispose().catch(() => {});
      await old.writer.dispose().catch(() => {});
    } finally {
      release();
    }
  }
  get provider() { return this.writer.provider; }
  get adapterName() { return this.writer.adapterName; }
  async queryRaw(q: SqlQuery): Promise<SqlResultSet> {
    if (isPlainRead(q.sql)) return this.reader.queryRaw(q);
    const release = await this.#lock.acquire(WRITE_WAIT_MS);
    try { return await this.writer.queryRaw(q); } finally { release(); }
  }
  async executeRaw(q: SqlQuery): Promise<number> {
    const release = await this.#lock.acquire(WRITE_WAIT_MS);
    try { return await this.writer.executeRaw(q); } finally { release(); }
  }
  async startTransaction(isolationLevel?: Parameters<SqlDriverAdapter["startTransaction"]>[0]): Promise<Transaction> {
    // Prisma's own maxWait bounds how long a transaction waits to start.
    const release = await this.#lock.acquire();
    try {
      return new SerialisedTransaction(await this.writer.startTransaction(isolationLevel), release);
    } catch (e) {
      release();
      throw e;
    }
  }
  async executeScript(script: string) {
    const release = await this.#lock.acquire(WRITE_WAIT_MS);
    try { return await this.writer.executeScript(script); } finally { release(); }
  }
  async dispose() {
    adapters.delete(this);
    if (this.reader !== this.writer) await this.reader.dispose();
    await this.writer.dispose();
  }
}

export type SqliteAdapterOptions = { url: string; timeoutMs?: number };

/** A Prisma driver adapter factory for one SQLite file. The folder is created; the file is created by SQLite on first use. */
export function sqliteAdapter(opts: SqliteAdapterOptions): SqlMigrationAwareDriverAdapterFactory {
  const file = opts.url.replace(/^file:/, "");
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const factory = new PrismaBetterSqlite3({ url: opts.url, timeout: opts.timeoutMs ?? 5000 });
  const open = async () => {
    const writer = await factory.connect();
    await writer.executeScript(SQLITE_PRAGMAS.join(";\n") + ";");
    // A restore or demo-clear that died mid-way (power cut) leaves no row: its transaction was rolled back. A row left
    // by an older build that forgot to revoke would let the next delete through, so start clean.
    await writer.executeScript('DELETE FROM "_fitron_guard"').catch(() => {});
    // An in-memory database is private to its handle, so it cannot have a separate reader.
    if (file === ":memory:") return { writer, reader: writer };
    const reader = await factory.connect();
    await reader.executeScript(["PRAGMA busy_timeout = 5000", "PRAGMA query_only = ON"].join(";\n") + ";");
    return { writer, reader };
  };
  const connect = async (): Promise<SqlDriverAdapter> => {
    const c = await open();
    return new LocalAdapter(c.writer, c.reader, open);
  };
  return { provider: "sqlite", adapterName: "fitron-sqlite", connect, connectToShadowDb: () => factory.connectToShadowDb() };
}
