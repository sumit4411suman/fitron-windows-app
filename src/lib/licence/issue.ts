import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { LICENCE_PREFIX, type Licence, type TrustedKey } from "./licence";

// FITRON's side of licensing, used by scripts/licence-keygen.ts and scripts/licence-issue.ts on FITRON's own computer.
// The app never imports this file: it only checks signatures (licence.ts) with public keys (keys.ts).

/** A new Ed25519 signing key: the private key as PEM (keep it offline), the public half as the app needs it. */
export function newSigningKey(id: string): { privatePem: string; trusted: TrustedKey } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    trusted: { id, publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64url") },
  };
}

/** The public half of a private key, as the app needs it (to check a key file against keys.ts). */
export const publicKeyOf = (privatePem: string) => createPublicKey(createPrivateKey(privatePem)).export({ format: "der", type: "spki" }).toString("base64url");

/** Signs a licence: the one-line text FITRON sends the gym. */
export function signLicence(licence: Licence, privatePem: string): string {
  const payload = Buffer.from(JSON.stringify(licence), "utf8").toString("base64url");
  const signature = sign(null, Buffer.from(payload, "utf8"), createPrivateKey(privatePem)).toString("base64url");
  return `${LICENCE_PREFIX}.${payload}.${signature}`;
}
