import { randomBytes } from "node:crypto";
import { sha256Hex } from "./encryption.js";

// Gym API keys: "wak_" + 40 hex chars. Only the SHA-256 of the key is stored; the prefix helps operators tell keys apart.
export const API_KEY_PREFIX = "wak_";

export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const key = API_KEY_PREFIX + randomBytes(24).toString("hex");
  return { key, hash: hashApiKey(key), prefix: key.slice(0, API_KEY_PREFIX.length + 6) };
}

export const hashApiKey = (key: string): string => sha256Hex(key);

export const looksLikeApiKey = (s: string): boolean => /^wak_[0-9a-f]{48}$/.test(s);
