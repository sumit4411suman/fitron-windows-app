// FITRON only: issues a licence for a gym. Prints the one-line licence (and writes it to --out if given), which the gym
// imports in FITRON › Settings › Licence. With --installation the licence works only on that computer.
//   npm run licence:issue -- --key /secure/place/fitron-licence-2026.pem --key-id fitron-2026 --licence-id FIT-2026-00042 \
//     --licensee "Iron Gym, Pune" --plan professional --branches 1 --expires 2027-10-31 [--grace 15] [--installation <id>] [--out iron-gym.fitronlicence]
import { readFileSync, writeFileSync } from "node:fs";
import { publicKeyOf, signLicence } from "../src/lib/licence/issue";
import { verifyLicence, type Licence } from "../src/lib/licence/licence";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const need = (name: string) => {
  const v = arg(name);
  if (!v) {
    console.error(`Missing --${name}. See the usage at the top of scripts/licence-issue.ts.`);
    process.exit(1);
  }
  return v;
};

const privatePem = readFileSync(need("key"), "utf8");
const keyId = need("key-id");
const licence: Licence = {
  v: 1,
  licenceId: need("licence-id"),
  keyId,
  licensee: need("licensee"),
  plan: need("plan"),
  edition: "local",
  branches: Number(need("branches")),
  ...(arg("installation") ? { installationId: arg("installation")! } : {}),
  issuedOn: new Date().toISOString().slice(0, 10),
  expiresOn: need("expires"),
  graceDays: Number(arg("grace") ?? 15),
};
const text = signLicence(licence, privatePem);
// Check it the way the app will, so a typo never reaches a gym.
const v = verifyLicence(text, [{ id: keyId, publicKey: publicKeyOf(privatePem) }]);
if (!v.ok) {
  console.error(v.reason);
  process.exit(1);
}
const out = arg("out");
if (out) writeFileSync(out, `${text}\n`, { flag: "wx" });
console.log(text);
