import { spawn as nodeSpawn } from "node:child_process";
import path from "node:path";

// FITRON for Windows: opens a web page in the computer's own browser, from FITRON's server, which runs on that same
// computer. Used where a page must leave FITRON's window (paying for the licence on fitron.in): a link that asks the
// window for a new one depends on the window passing it on, and on some computers nothing opened. Only https addresses
// are opened; each goes to the operating system as one argument, never through a shell.
//
// On Windows the address goes to url.dll's FileProtocolHandler (what Windows itself runs for a link), shown normally:
// FITRON's server runs without a window, and a hidden start (explorer.exe with windowsHide) made the browser start
// hidden too, so a gym saw nothing open.

type Spawn = (cmd: string, args: string[], opts: { detached: boolean; stdio: "ignore"; windowsHide: boolean }) => { once(e: "spawn" | "error", f: (err?: Error) => void): unknown; unref(): void };

/** The program, and its arguments, that open an address in the default browser, by platform (on Windows, from the Windows folder itself). */
export function browserCommand(platform: NodeJS.Platform, url: string, env: Record<string, string | undefined> = process.env): { cmd: string; args: string[] } {
  if (platform === "win32") return { cmd: env.SystemRoot ? path.win32.join(env.SystemRoot, "System32", "rundll32.exe") : "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] };
  if (platform === "darwin") return { cmd: "open", args: [url] };
  return { cmd: "xdg-open", args: [url] };
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
  const c = browserCommand(o.platform ?? process.platform, u.toString(), o.env ?? process.env);
  // Not windowsHide: the browser takes how it is shown from the program that starts it.
  const run = (o.spawn ?? (nodeSpawn as unknown as Spawn))(c.cmd, c.args, { detached: true, stdio: "ignore", windowsHide: false });
  return new Promise((resolve) => {
    run.once("spawn", () => {
      run.unref();
      resolve(true);
    });
    run.once("error", () => resolve(false));
  });
}
