import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { browserCommand, openInBrowser } from "./open-in-browser";

const fake = (outcome: "spawn" | "error") => {
  const calls: { cmd: string; args: string[]; hidden: boolean }[] = [];
  const spawn = (cmd: string, args: string[], opts: { windowsHide: boolean }) => {
    calls.push({ cmd, args, hidden: opts.windowsHide });
    const p = Object.assign(new EventEmitter(), { unref: () => {} });
    queueMicrotask(() => p.emit(outcome, outcome === "error" ? new Error("ENOENT") : undefined));
    return p;
  };
  return { spawn, calls };
};

describe("opening a page in the computer's browser", () => {
  it("uses the platform's own opener", () => {
    const u = "https://fitron.in/windows/buy";
    expect(browserCommand("win32", u, { SystemRoot: "C:\\Windows" })).toEqual({ cmd: "C:\\Windows\\System32\\rundll32.exe", args: ["url.dll,FileProtocolHandler", u] });
    expect(browserCommand("win32", u, {}).cmd).toBe("rundll32.exe");
    expect(browserCommand("darwin", u)).toEqual({ cmd: "open", args: [u] });
    expect(browserCommand("linux", u)).toEqual({ cmd: "xdg-open", args: [u] });
  });

  it("hands the whole address over as one argument, query and all, and does not start the browser hidden", async () => {
    const f = fake("spawn");
    const url = "https://fitron.in/windows/buy?i=b8e6d0c5-ec1e-4d1c-bf2e-b0b1c0cb5f3d&c=AbC_dEf-123";
    expect(await openInBrowser(url, { platform: "win32", env: { SystemRoot: "C:\\Windows" }, spawn: f.spawn })).toBe(true);
    expect(f.calls).toEqual([{ cmd: "C:\\Windows\\System32\\rundll32.exe", args: ["url.dll,FileProtocolHandler", url], hidden: false }]);
  });

  it("says when the opener could not start", async () => {
    expect(await openInBrowser("https://fitron.in/windows/buy", { platform: "win32", spawn: fake("error").spawn })).toBe(false);
  });

  it("opens nothing but https", async () => {
    for (const url of ["http://fitron.in/", "file:///C:/Windows/System32/calc.exe", "javascript:alert(1)", "not a url", "ms-settings:privacy"]) {
      const f = fake("spawn");
      expect(await openInBrowser(url, { platform: "win32", spawn: f.spawn }), url).toBe(false);
      expect(f.calls, url).toEqual([]);
    }
  });
});
