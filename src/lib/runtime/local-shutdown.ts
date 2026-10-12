import Database from "better-sqlite3";
import { log } from "@/lib/log";

// FITRON for Windows: how the server stops when FITRON closes. The desktop shell (src-tauri) starts the server with
// FITRON_SHELL=1 and keeps the other end of its standard input. Closing FITRON closes that pipe; so does the shell
// ending any other way (a crash, Task Manager), since Windows closes a dead process's pipes. Either way the server then:
//   1. stops its hourly timer, so no backup or daily job starts;
//   2. waits a little for a backup or a job already running, which writes to a temporary file and renames it at the end;
//   3. lets a WhatsApp message being sent through a phone linked in FITRON finish, and closes the link (not logged out);
//   4. writes everything in the WAL into the database file (a TRUNCATE checkpoint), so fitron.db alone is complete;
//   5. exits.
// A request half-way through a transaction when the process exits is rolled back by SQLite as a whole: a payment is
// either saved with its receipt and journal or not at all. Signals are not used because Windows has none to send to a
// program without a console.

const g = globalThis as unknown as { fitronScheduler?: NodeJS.Timeout; fitronAutoBackupRunning?: boolean; fitronJobsRunning?: boolean; fitronStopping?: boolean; fitronWhatsApp?: Map<string, unknown> };

export const SHUTDOWN_WAIT_MS = 8_000;

const busy = () => !!(g.fitronAutoBackupRunning || g.fitronJobsRunning);

/** Moves every committed change from the WAL into the database file and empties the WAL. */
export function checkpoint(file: string) {
  const conn = new Database(file, { timeout: 5_000 });
  try {
    conn.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    conn.close();
  }
}

export async function stopLocalServer(o: { database: string; waitMs?: number; exit?: (code: number) => void; sleep?: (ms: number) => Promise<void> }) {
  if (g.fitronStopping) return;
  g.fitronStopping = true;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const exit = o.exit ?? ((code: number) => process.exit(code));
  if (g.fitronScheduler) clearInterval(g.fitronScheduler);
  g.fitronScheduler = undefined;
  const until = Date.now() + (o.waitMs ?? SHUTDOWN_WAIT_MS);
  while (busy() && Date.now() < until) await sleep(100);
  if (busy()) log.warn("local.stop.busy", { backup: !!g.fitronAutoBackupRunning, jobs: !!g.fitronJobsRunning });
  if (g.fitronWhatsApp?.size) {
    try {
      const { stopEmbeddedWhatsApp } = await import("@/lib/integrations/whatsapp/embedded");
      await stopEmbeddedWhatsApp(Math.max(0, until - Date.now()));
    } catch (e) {
      log.error("local.stop.whatsapp_failed", e);
    }
  }
  let code = 0;
  try {
    checkpoint(o.database);
    log.info("local.stop");
  } catch (e) {
    // Nothing is lost: the WAL stays beside the database and SQLite reads it the next time FITRON opens.
    code = 1;
    log.error("local.stop.checkpoint_failed", e);
  }
  exit(code);
}

/** Started by the desktop shell: stop cleanly when the shell lets go of standard input. */
export function stopWhenShellCloses(database: string, input: NodeJS.ReadableStream = process.stdin) {
  const stop = () => void stopLocalServer({ database });
  input.on("end", stop);
  input.on("close", stop);
  input.on("error", stop);
  // Reading is what makes "end" arrive. Nothing is sent on this pipe; anything that is, is ignored.
  input.on("data", () => {});
  input.resume();
}

/** True while the server is stopping (the shell is closing FITRON). */
export const localStopping = () => !!g.fitronStopping;
