import { spawn as nodeSpawn } from "node:child_process";
import path from "node:path";

// FITRON for Windows: opens a web page in the computer's own browser, from FITRON's server, which runs on that same
// computer. Used where a page must leave FITRON's window (paying for the licence on fitron.in): a link that asks the
// window for a new one depends on the window passing it on, and on some computers nothing opened. Only https addresses
// are opened; each goes to the operating system as one argument, never through a shell.

type Spawn = (cmd: string, args: string[], opts: { detached: boolean; stdio: "ignore"; windowsHide: boolean }) => { once(e: "spawn" | "error", f: (err?: Error) => void): unknown; unref(): void };

/** The program that opens an address in the default browser, by platform (on Windows, from the Windows folder itself). */
export function browserCommand(platform: NodeJS.Platform, env: Record<string, string | undefined> = process.env): string {
  if (platform === "win32") return env.SystemRoot ? path.win32.join(env.SystemRoot, "explorer.exe") : "explorer.exe";
  if (platform === "darwin") return "open";
  return "xdg-open";
}

/** Opens `url` in the default browser. True once the opener started; false when it could not (or the address is not https). */
export function openInBrowser(url: string, o: { platform?: NodeJS.Platform; env?: Record<string, string | undefined>; spawn?: Spawn } = {}): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return Promise.resolve(false);
  }
  if (u.protocol !== "https:") return Promise.resolve(false);
  const run = (o.spawn ?? (nodeSpawn as unknown as Spawn))(browserCommand(o.platform ?? process.platform, o.env ?? process.env), [u.toString()], { detached: true, stdio: "ignore", windowsHide: true });
  return new Promise((resolve) => {
    run.once("spawn", () => {
      run.unref();
      resolve(true);
    });
    run.once("error", () => resolve(false));
  });
}
