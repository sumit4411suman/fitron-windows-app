// npm run desktop:signature (Windows, Phase 25): what Windows says about the signatures of FITRON's files, as a customer's
// computer will see them: the installer, the program, its Node.js runtime, and (with --dir) every .exe and .dll of an
// installed copy. Report only by default (a development build is unsigned, and says so); with --require, or
// FITRON_REQUIRE_SIGNED=1 (the release workflow), it fails unless every file is signed by FITRON_PUBLISHER (default
// "FITRON"), valid, and timestamped. Checks only: it never signs, and never changes what Windows trusts.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import pkg from "../package.json";
import { judgeSignatures, type FileSignature } from "../src/lib/domain/authenticode";

const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const mustSign = args.includes("--require") || process.env.FITRON_REQUIRE_SIGNED === "1";
const dirAt = args.indexOf("--dir");
const publisher = process.env.FITRON_PUBLISHER?.trim() || "FITRON";

function files(): string[] {
  if (dirAt >= 0) {
    const dir = path.resolve(args[dirAt + 1] ?? "");
    const out: string[] = [];
    for (const e of readdirSync(dir, { recursive: true, withFileTypes: true })) if (e.isFile() && /\.(exe|dll)$/i.test(e.name) && !/node_modules/i.test(e.parentPath)) out.push(path.join(e.parentPath, e.name));
    return out;
  }
  const release = path.join(root, "src-tauri", "target", "release");
  return [
    path.join(root, "dist", "desktop", `FITRON-Gym-Accounting-Setup-${pkg.version}.exe`),
    ...["fitron.exe", "FITRON Gym Accounting.exe"].map((n) => path.join(release, n)).filter(existsSync).slice(0, 1),
    ...readdirSync(release).filter((n) => /^fitron-node.*\.exe$/i.test(n)).map((n) => path.join(release, n)),
  ].filter(existsSync);
}

function signatures(list: string[]): FileSignature[] {
  // One PowerShell for all files; paths go in through the environment, never through the command line's quoting. Any
  // error stops it: a cmdlet that failed to load must not read as an empty status.
  const ps = `
    $ErrorActionPreference = "Stop"
    $files = $env:FITRON_SIGN_FILES -split "\`n" | Where-Object { $_ }
    $out = foreach ($f in $files) {
      $s = Get-AuthenticodeSignature -LiteralPath $f
      [pscustomobject]@{ file = $f; status = [string]$s.Status; signer = $s.SignerCertificate.Subject; timestamper = $s.TimeStamperCertificate.Subject }
    }
    ConvertTo-Json -InputObject @($out) -Compress`;
  // Windows PowerShell builds its own module path; one inherited from PowerShell 7 (a pwsh CI step) points it at
  // PowerShell 7's Microsoft.PowerShell.Security, which it cannot load, and Get-AuthenticodeSignature goes missing.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toLowerCase() !== "psmodulepath")) as NodeJS.ProcessEnv;
  const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8", env: { ...env, FITRON_SIGN_FILES: list.join("\n") }, windowsHide: true });
  if (r.status !== 0) throw new Error(`Get-AuthenticodeSignature failed: ${r.stderr || r.stdout}`);
  return (JSON.parse(r.stdout) as FileSignature[]).map((s) => ({ ...s, file: path.relative(root, s.file) || s.file, signer: s.signer || null, timestamper: s.timestamper || null }));
}

function main() {
  if (process.platform !== "win32") throw new Error("Signatures are checked on Windows (Get-AuthenticodeSignature).");
  const list = files();
  const verdict = judgeSignatures(list.length ? signatures(list) : [], { require: mustSign, publisher });
  console.log(`FITRON signatures (${mustSign ? `release: must be signed by ${publisher}` : "report"})`);
  for (const l of verdict.lines) console.log(`  ${l}`);
  if (!verdict.ok) process.exit(1);
}

main();
