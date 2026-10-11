// FITRON only, once: makes the licence signing key. The private key goes to the file you name (keep it offline, backed
// up, never in this repository); the line it prints goes into src/lib/licence/keys.ts before building a release.
//   npm run licence:keygen -- --id fitron-2026 --out /secure/place/fitron-licence-2026.pem
import { existsSync, writeFileSync } from "node:fs";
import { newSigningKey } from "../src/lib/licence/issue";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const id = arg("id");
const out = arg("out");
if (!id || !/^[a-z0-9-]{3,40}$/.test(id) || !out) {
  console.error("Usage: npm run licence:keygen -- --id fitron-2026 --out /secure/place/fitron-licence-2026.pem");
  process.exit(1);
}
if (existsSync(out)) {
  console.error(`${out} already exists. A signing key is never overwritten: licences signed with it would stop being checkable.`);
  process.exit(1);
}
const k = newSigningKey(id);
writeFileSync(out, k.privatePem, { mode: 0o600, flag: "wx" });
console.log(`Private key written to ${out}. Keep it offline and backed up; anyone with it can issue licences.`);
console.log("Add this line to FITRON_LICENCE_KEYS in src/lib/licence/keys.ts:");
console.log(`  ${JSON.stringify(k.trusted)},`);
