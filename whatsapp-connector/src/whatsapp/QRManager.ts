import QRCode from "qrcode";
import type { RedisClient } from "../config/redis.js";
import { REDIS_KEYS } from "../types/index.js";

export const QR_TTL_SECONDS = 60;

/**
 * Turns the pairing payload into a PNG data URL and keeps the latest one per gym in Redis for QR_TTL_SECONDS so an
 * events stream that opens a moment later still gets it. The raw payload is never logged.
 */
export class QRManager {
  constructor(private readonly redis: RedisClient) {}

  async render(qr: string): Promise<string> {
    return QRCode.toDataURL(qr, { margin: 1, width: 320, errorCorrectionLevel: "M" });
  }

  async store(gymId: string, dataUrl: string): Promise<{ expiresAt: string }> {
    const expiresAt = new Date(Date.now() + QR_TTL_SECONDS * 1000).toISOString();
    await this.redis.set(REDIS_KEYS.qr(gymId), JSON.stringify({ dataUrl, expiresAt }), "EX", QR_TTL_SECONDS);
    return { expiresAt };
  }

  async current(gymId: string): Promise<{ dataUrl: string; expiresAt: string } | null> {
    const raw = await this.redis.get(REDIS_KEYS.qr(gymId));
    if (!raw) return null;
    try {
      const v = JSON.parse(raw) as { dataUrl: string; expiresAt: string };
      return new Date(v.expiresAt).getTime() > Date.now() ? v : null;
    } catch {
      return null;
    }
  }

  async clear(gymId: string): Promise<void> {
    await this.redis.del(REDIS_KEYS.qr(gymId));
  }
}
