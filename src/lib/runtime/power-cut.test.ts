import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { SQLITE_PRAGMAS } from "./sqlite-adapter";

// What FITRON for Windows relies on when the power goes (docs/local-windows/DISASTER-RECOVERY.md): with the pragmas
// every connection uses (WAL, synchronous=FULL), a process killed in the middle of a transaction leaves nothing of it,
// and one killed right after a commit keeps all of it. A separate process is killed with SIGKILL, as a power cut ends
// a program: no clean-up, no rollback of its own.

/** Runs `steps` in a child process on `file`, kills it when it prints "ready", and waits for it to end. */
function killMidway(file: string, commit: boolean): Promise<void> {
  const code = `
    const Database = require("better-sqlite3");
    const db = new Database(${JSON.stringify(file)});
    for (const p of ${JSON.stringify(SQLITE_PRAGMAS)}) db.exec(p);
    db.exec("BEGIN IMMEDIATE");
    db.prepare("INSERT INTO pay (invoice, amount) VALUES (?, ?)").run("INV-1", 50000);
    db.prepare("INSERT INTO audit (what) VALUES (?)").run("payment.create");
    if (${commit}) db.exec("COMMIT");
    process.stdout.write("ready\\n");
    setInterval(() => {}, 1000);
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", code], { cwd: process.cwd(), stdio: ["ignore", "pipe", "inherit"] });
    child.stdout.on("data", (d) => String(d).includes("ready") && child.kill("SIGKILL"));
    child.on("exit", () => resolve());
    child.on("error", reject);
  });
}

function fresh() {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "fitron-power-")), "fitron.db");
  const db = new Database(file);
  for (const p of SQLITE_PRAGMAS) db.exec(p);
  db.exec("CREATE TABLE pay (invoice TEXT, amount INTEGER); CREATE TABLE audit (what TEXT);");
  db.close();
  return file;
}

const after = (file: string) => {
  const db = new Database(file);
  try {
    return { pays: db.prepare("SELECT COUNT(*) AS n FROM pay").get(), audits: db.prepare("SELECT COUNT(*) AS n FROM audit").get(), check: db.pragma("integrity_check", { simple: true }) };
  } finally {
    db.close();
  }
};

describe("power lost while FITRON writes", () => {
  it("a payment half-way through its transaction is not there at all, and the database is whole", async () => {
    const file = fresh();
    await killMidway(file, false);
    expect(after(file)).toEqual({ pays: { n: 0 }, audits: { n: 0 }, check: "ok" });
  });

  it("a payment whose transaction committed is all there, with its audit entry", async () => {
    const file = fresh();
    await killMidway(file, true);
    expect(after(file)).toEqual({ pays: { n: 1 }, audits: { n: 1 }, check: "ok" });
  });
});
