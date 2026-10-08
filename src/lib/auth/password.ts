import { hash, verify } from "@node-rs/argon2";

// Argon2id with OWASP's recommended minimums.
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (pw: string) => hash(pw, OPTS);

export const verifyPassword = async (hashed: string, pw: string) => {
  try {
    return await verify(hashed, pw);
  } catch {
    return false;
  }
};
