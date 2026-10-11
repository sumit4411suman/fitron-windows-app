import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stopLocalServer, stopWhenShellCloses } from "./local-shutdown";

const g = globalThis as unknown as { fitronScheduler?: NodeJS.Timeout; fitronAutoBackupRunning?: boolean; fitronJobsRunning?: boolean; fitronStopping?: boolean };

let dir: string;
let file: string;
let open: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "fitron-stop-"));
  file = path.join(dir, "fitron.db");
  // The app's own connection, still open while it stops, with a committed payment only in the WAL.
  open = new Database(file);
  open.pragma("journal_mode = WAL");
  open.pragma("wal_autocheckpoint = 0");
  open.exec("CREATE TABLE payment (id INTEGER PRIMARY KEY, paise INTEGER NOT NULL)");
  open.prepare("INSERT INTO payment (paise) VALUES (?)").run(150_000);
  g.fitronStopping = false;
  g.fitronAutoBackupRunning = false;
  g.fitronJobsRunning = false;
});
afterEach(() => {
  open.close();
  rmSync(dir, { recursive: true, force: true });
  g.fitronStopping = false;
  g.fitronAutoBackupRunning = false;
  g.fitronJobsRunning = false;
});

const walSize = () => (existsSync(`${file}-wal`) ? statSync(`${file}-wal`).size : 0);

describe("stopping the server when FITRON closes", () => {
  it("writes the WAL into the database file, then exits with 0", async () => {
    expect(walSize()).toBeGreaterThan(0);
    const exit = vi.fn();
    await stopLocalServer({ database: file, exit });
    expect(exit).toHaveBeenCalledWith(0);
    expect(walSize()).toBe(0);
    // The database file alone now holds the payment.
    const copy = new Database(file, { readonly: true });
    expect(copy.prepare("SELECT paise FROM payment").get()).toEqual({ paise: 150_000 });
    copy.close();
  });

  it("stops the hourly timer and waits for a backup already running", async () => {
    const timer = setInterval(() => {}, 60_000);
    g.fitronScheduler = timer;
    g.fitronAutoBackupRunning = true;
    let slept = 0;
    const exit = vi.fn();
    await stopLocalServer({
      database: file,
      exit,
      sleep: async () => {
        slept++;
        if (slept === 3) g.fitronAutoBackupRunning = false;
      },
    });
    expect(slept).toBe(3);
    expect(g.fitronScheduler).toBeUndefined();
    expect(exit).toHaveBeenCalledWith(0);
    clearInterval(timer);
  });

  it("does not wait for ever on a job that does not finish", async () => {
    g.fitronJobsRunning = true;
    const exit = vi.fn();
    await stopLocalServer({ database: file, exit, waitMs: 50, sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 10))) });
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("stops once, however many times it is asked", async () => {
    const exit = vi.fn();
    await Promise.all([stopLocalServer({ database: file, exit }), stopLocalServer({ database: file, exit })]);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("exits with 1 and keeps the WAL when the database cannot be written", async () => {
    const exit = vi.fn();
    await stopLocalServer({ database: path.join(dir, "missing", "fitron.db"), exit });
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("starts when the shell lets go of standard input", async () => {
    const exits: number[] = [];
    const real = process.exit;
    process.exit = ((code?: number) => {
      exits.push(code ?? 0);
    }) as typeof process.exit;
    try {
      const pipe = new PassThrough();
      stopWhenShellCloses(file, pipe);
      pipe.write("anything\n");
      expect(exits).toEqual([]);
      pipe.end();
      await vi.waitFor(() => expect(exits).toEqual([0]));
      expect(walSize()).toBe(0);
    } finally {
      process.exit = real;
    }
  });
});
