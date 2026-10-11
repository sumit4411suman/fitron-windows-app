import type { NextFunction, Request, Response } from "express";
import type { GymService } from "../services/GymService.js";
import { AppError } from "../utils/errors.js";
import { safeEqual } from "../utils/encryption.js";
import { looksLikeApiKey } from "../utils/apiKey.js";

const bearer = (req: Request): string | null => {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m?.[1]?.trim() ?? null;
};

/** Authorization: Bearer <gym api key>. Attaches req.principal = { kind: "gym", gymId }. */
export function gymAuth(gyms: GymService) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const key = bearer(req);
      if (!key) throw new AppError("UNAUTHORIZED", "Missing Authorization: Bearer <api key> header.");
      if (!looksLikeApiKey(key)) throw new AppError("INVALID_API_KEY", "Invalid API key.");
      const principal = await gyms.authenticate(key);
      if (!principal) throw new AppError("INVALID_API_KEY", "Invalid API key.");
      req.principal = principal;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Authorization: Bearer <WA_CONNECTOR_MASTER_KEY>. Administration only (creating gyms, rotating keys). */
export function masterAuth(masterKey: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const key = bearer(req);
    if (!key || !safeEqual(key, masterKey)) return next(new AppError("INVALID_API_KEY", "Invalid master key."));
    req.principal = { kind: "master" };
    next();
  };
}

/** The gym of the current request. Routes under gymAuth can rely on it. */
export function gymOf(req: Request): { gymId: string; gymName: string } {
  const p = req.principal;
  if (!p || p.kind !== "gym") throw new AppError("UNAUTHORIZED", "A gym API key is required.");
  return { gymId: p.gymId, gymName: p.gymName };
}
