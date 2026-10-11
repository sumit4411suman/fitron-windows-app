// Temporary (removed with the fix): measures how permission changes on a per-user program folder affect starting a
// program from it on the Windows runner. The installer test's "read-only program folder" step fails there with
// "spawn EPERM" (CreateProcess: access denied) with two different permission sets; this isolates the right it needs.
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.join(process.env.LOCALAPPDATA, "fitron-acl-probe");
const exe = path.join(root, "probe.exe");
const me = process.env.USERNAME ?? os.userInfo().username;
const indent = (s) => s.split("\n").map((l) => `    ${l}`).join("\n");

function sh(file, args) {
  const r = spawnSync(file, args, { encoding: "utf8", windowsHide: true });
  return `$ ${file} ${args.join(" ")}\n${(r.stdout ?? "").trimEnd()}\n${(r.stderr ?? "").trimEnd()}\n(exit ${r.status}${r.error ? `, error ${r.error.code}` : ""})`;
}

function fresh() {
  if (fs.existsSync(root)) sh("icacls", [root, "/reset", "/T", "/C", "/Q"]);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, "sub"), { recursive: true });
  fs.copyFileSync(process.execPath, exe);
  fs.writeFileSync(path.join(root, "sub", "a.txt"), "a");
}

function attempt(label) {
  const notes = [];
  try {
    const c = spawn(exe, ["--version"], { stdio: "ignore", windowsHide: true });
    notes.push(`spawn: ok (pid ${c.pid})`);
    c.on("error", (e) => console.log(`    [${label}] later: ${e.message}`));
  } catch (e) {
    notes.push(`spawn: threw ${e.message}`);
  }
  const r = spawnSync(exe, ["--version"], { encoding: "utf8", windowsHide: true });
  notes.push(`spawnSync: status ${r.status}${r.error ? ` error ${r.error.code}` : ""} out ${(r.stdout ?? "").trim()}`);
  const p = spawnSync("pwsh", ["-NoProfile", "-Command", `& '${exe}' --version; exit $LASTEXITCODE`], { encoding: "utf8", windowsHide: true });
  notes.push(`pwsh: status ${p.status} out ${(p.stdout ?? "").trim()} err ${((p.stderr ?? "").trim().split("\n")[0] ?? "").slice(0, 160)}`);
  try { fs.closeSync(fs.openSync(exe, "r")); notes.push("open exe for reading: ok"); } catch (e) { notes.push(`open exe for reading: ${e.code}`); }
  try { fs.writeFileSync(path.join(root, "new.txt"), "x"); notes.push("create a file in the folder: ALLOWED"); } catch (e) { notes.push(`create a file in the folder: ${e.code}`); }
  try { fs.appendFileSync(path.join(root, "sub", "a.txt"), "b"); notes.push("append to a file: ALLOWED"); } catch (e) { notes.push(`append to a file: ${e.code}`); }
  console.log(notes.map((n) => `    ${n}`).join("\n"));
  console.log(indent(sh("icacls", [exe])));
}

// RX spelled as specific rights, to combine with one write-type right: read control, synchronize, read data,
// read attributes, read extended attributes, execute.
const RX = "RC,S,RD,RA,REA,X";
const variants = [
  ["control: untouched", null],
  ["A: the harness today: /inheritance:r, me RX, SYSTEM F, /T", [root, "/inheritance:r", "/grant:r", `${me}:(OI)(CI)RX`, "/grant:r", "*S-1-5-18:(OI)(CI)F", "/T", "/C", "/Q"]],
  ["B: the same without /T (inheritance propagates)", [root, "/inheritance:r", "/grant:r", `${me}:(OI)(CI)RX`, "/grant:r", "*S-1-5-18:(OI)(CI)F"]],
  ["C: deny me the write and delete rights on the tree", [root, "/deny", `${me}:(OI)(CI)(WD,AD,WEA,WA,D,DC)`, "/T", "/C", "/Q"]],
  ["D: deny me WA only", [root, "/deny", `${me}:(OI)(CI)(WA)`, "/T", "/C", "/Q"]],
  ["E: deny me WEA only", [root, "/deny", `${me}:(OI)(CI)(WEA)`, "/T", "/C", "/Q"]],
  ["F: deny me D only", [root, "/deny", `${me}:(OI)(CI)(D)`, "/T", "/C", "/Q"]],
  ["G: deny me WD,AD only", [root, "/deny", `${me}:(OI)(CI)(WD,AD)`, "/T", "/C", "/Q"]],
  ["H: deny me DC only", [root, "/deny", `${me}:(OI)(CI)(DC)`, "/T", "/C", "/Q"]],
  ["I: deny on the exe file only", [exe, "/deny", `${me}:(WD,AD,WEA,WA,D,DC)`]],
  ["J: deny on the folder only, not its files", [root, "/deny", `${me}:(CI)(WD,AD,WEA,WA,D,DC)`]],
  ["K: me RX + Administrators RX + SYSTEM F, /T", [root, "/inheritance:r", "/grant:r", `${me}:(OI)(CI)RX`, "/grant:r", "*S-1-5-32-544:(OI)(CI)RX", "/grant:r", "*S-1-5-18:(OI)(CI)F", "/T", "/C", "/Q"]],
  ["L: me RX+WA + SYSTEM F, /T", [root, "/inheritance:r", "/grant:r", `${me}:(OI)(CI)(${RX},WA)`, "/grant:r", "*S-1-5-18:(OI)(CI)F", "/T", "/C", "/Q"]],
  ["M: me RX+DE + SYSTEM F, /T", [root, "/inheritance:r", "/grant:r", `${me}:(OI)(CI)(${RX},DE)`, "/grant:r", "*S-1-5-18:(OI)(CI)F", "/T", "/C", "/Q"]],
  ["N: me RX+WEA + SYSTEM F, /T", [root, "/inheritance:r", "/grant:r", `${me}:(OI)(CI)(${RX},WEA)`, "/grant:r", "*S-1-5-18:(OI)(CI)F", "/T", "/C", "/Q"]],
  ["O: me RX + Everyone RX + SYSTEM F, /T", [root, "/inheritance:r", "/grant:r", `${me}:(OI)(CI)RX`, "/grant:r", "*S-1-1-0:(OI)(CI)RX", "/grant:r", "*S-1-5-18:(OI)(CI)F", "/T", "/C", "/Q"]],
];

(async () => {
  console.log(sh("whoami", ["/user"]));
  console.log(sh("whoami", ["/groups", "/fo", "list"]).split("\n").filter((l) => /Group Name|Label|S-1-5-32-544|S-1-5-32-545|S-1-1-0|S-1-5-11/.test(l)).join("\n"));
  console.log(`USERNAME=${process.env.USERNAME} userInfo=${os.userInfo().username} node=${process.version}`);
  for (const [label, args] of variants) {
    console.log(`\n=== ${label}`);
    fresh();
    if (args) console.log(indent(sh("icacls", args)));
    attempt(label);
    await new Promise((r) => setTimeout(r, 1500));
  }
  fresh();
  fs.rmSync(root, { recursive: true, force: true });
})();
