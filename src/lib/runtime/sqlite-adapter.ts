import { mkdirSync } from "node:fs";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import type { SqlDriverAdapter, SqlMigrationAwareDriverAdapterFactory, SqlQuery, SqlResultSet, Transaction } from "@prisma/driver-adapter-utils";

// The Local Edition's database driver: better-sqlite3 through Prisma's adapter, with two things the plain adapter does
// not do.
//
// 1. Connection settings, run before the first query: foreign keys on (SQLite leaves them off by default), WAL journal
//    (readers never block the writer, and a crash leaves a consistent file), synchronous=FULL (a committed payment is on
//    disk before the app says so, even if the power goes), and a busy timeout for the backup tool's short locks.
//
// 2. One statement at a time. better-sqlite3 is one connection, and the adapter only locks it for the span of a
//    transaction: a query that arrives while a transaction is open would run inside it on the same connection, seeing
//    uncommitted rows or being committed with them. Every top-level query here takes the same lock the transactions
//    take, so a page rendering while a restore runs waits for the restore to finish instead of reading half of it.
//    SQLite allows one writer anyway, so this costs nothing it was not paying already.

export const SQLITE_PRAGMAS = ["PRAGMA foreign_keys = ON", "PRAGMA journal_mode = WAL", "PRAGMA synchronous = FULL", "PRAGMA busy_timeout = 5000", "PRAGMA temp_store = MEMORY"];

class Lock {
  #tail: Promise<void> = Promise.resolve();
  /** Resolves when it is this caller's turn; the returned function hands the turn on. */
  acquire(): Promise<() => void> {
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    const turn = this.#tail.then(() => release);
    this.#tail = this.#tail.then(() => mine);
    return turn;
  }
}

class SerialisedTransaction implements Transaction {
  constructor(private readonly inner: Transaction, private readonly release: () => void) {}
  get provider() { return this.inner.provider; }
  get adapterName() { return this.inner.adapterName; }
  get options() { return this.inner.options; }
  queryRaw(q: SqlQuery) { return this.inner.queryRaw(q); }
  executeRaw(q: SqlQuery) { return this.inner.executeRaw(q); }
  async commit() { try { await this.inner.commit(); } finally { this.release(); } }
  async rollback() { try { await this.inner.rollback(); } finally { this.release(); } }
}

class SerialisedAdapter implements SqlDriverAdapter {
  readonly #lock = new Lock();
  constructor(private readonly inner: SqlDriverAdapter) {}
  get provider() { return this.inner.provider; }
  get adapterName() { return this.inner.adapterName; }
  async queryRaw(q: SqlQuery): Promise<SqlResultSet> {
    const release = await this.#lock.acquire();
    try { return await this.inner.queryRaw(q); } finally { release(); }
  }
  async executeRaw(q: SqlQuery): Promise<number> {
    const release = await this.#lock.acquire();
    try { return await this.inner.executeRaw(q); } finally { release(); }
  }
  async startTransaction(isolationLevel?: Parameters<SqlDriverAdapter["startTransaction"]>[0]): Promise<Transaction> {
    const release = await this.#lock.acquire();
    try {
      return new SerialisedTransaction(await this.inner.startTransaction(isolationLevel), release);
    } catch (e) {
      release();
      throw e;
    }
  }
  executeScript(script: string) { return this.inner.executeScript(script); }
  dispose() { return this.inner.dispose(); }
  getConnectionInfo = this.inner.getConnectionInfo ? () => this.inner.getConnectionInfo!() : undefined;
}

export type SqliteAdapterOptions = { url: string; timeoutMs?: number };

/** A Prisma driver adapter factory for one SQLite file. The folder is created; the file is created by SQLite on first use. */
export function sqliteAdapter(opts: SqliteAdapterOptions): SqlMigrationAwareDriverAdapterFactory {
  const file = opts.url.replace(/^file:/, "");
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const factory = new PrismaBetterSqlite3({ url: opts.url, timeout: opts.timeoutMs ?? 5000 });
  const connect = async (): Promise<SqlDriverAdapter> => {
    const inner = await factory.connect();
    await inner.executeScript(SQLITE_PRAGMAS.join(";\n") + ";");
    // A restore or demo-clear that died mid-way (power cut) leaves no row: its transaction was rolled back. A row left
    // by an older build that forgot to revoke would let the next delete through, so start clean.
    await inner.executeScript('DELETE FROM "_fitron_guard"').catch(() => {});
    return new SerialisedAdapter(inner);
  };
  return { provider: "sqlite", adapterName: "fitron-sqlite", connect, connectToShadowDb: () => factory.connectToShadowDb() };
}
