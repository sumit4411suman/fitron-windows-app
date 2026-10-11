import { Router } from "express";
import type { Container } from "../../server/container.js";
import { gymAuth, gymOf, masterAuth } from "../../middleware/apiKeyAuth.js";
import { adminRateLimiter } from "../../middleware/rateLimiter.js";
import { validateBody, wrap } from "../../middleware/validate.js";
import { gymCreateBody, gymPatchBody } from "../schemas.js";

/** Administration (master key): gyms and their API keys. Plus GET /gyms/me for a gym to check its own key. */
export function gymRoutes(c: Container): Router {
  const r = Router();
  const admin = [adminRateLimiter(), masterAuth(c.env.WA_CONNECTOR_MASTER_KEY)] as const;

  r.get(
    "/me",
    gymAuth(c.gyms),
    wrap(async (req, res) => {
      const { gymId } = gymOf(req);
      res.json({ success: true, data: await c.gyms.get(gymId) });
    }),
  );

  r.post(
    "/",
    ...admin,
    validateBody(gymCreateBody),
    wrap(async (req, res) => {
      const gym = await c.gyms.create(req.body);
      c.logger.info({ gymId: gym.gymId }, "gym created");
      res.status(201).json({ success: true, data: gym });
    }),
  );
  r.get(
    "/",
    ...admin,
    wrap(async (_req, res) => {
      res.json({ success: true, data: await c.gyms.list() });
    }),
  );
  r.get(
    "/by-external/:externalId",
    ...admin,
    wrap(async (req, res) => {
      const gym = await c.gyms.findByExternalId(String(req.params.externalId));
      if (!gym) return res.status(404).json({ success: false, error: { code: "GYM_NOT_FOUND", message: "Gym not found." } });
      res.json({ success: true, data: gym });
    }),
  );
  r.get(
    "/:gymId",
    ...admin,
    wrap(async (req, res) => {
      res.json({ success: true, data: await c.gyms.get(String(req.params.gymId)) });
    }),
  );
  r.patch(
    "/:gymId",
    ...admin,
    validateBody(gymPatchBody),
    wrap(async (req, res) => {
      res.json({ success: true, data: await c.gyms.update(String(req.params.gymId), req.body) });
    }),
  );
  r.post(
    "/:gymId/rotate-key",
    ...admin,
    wrap(async (req, res) => {
      const out = await c.gyms.rotateKey(String(req.params.gymId));
      c.logger.info({ gymId: out.gymId }, "gym api key rotated");
      res.json({ success: true, data: out });
    }),
  );
  r.delete(
    "/:gymId",
    ...admin,
    wrap(async (req, res) => {
      const gymId = String(req.params.gymId);
      await c.gyms.remove(gymId);
      await c.sessions.disconnect(gymId, true);
      c.logger.info({ gymId }, "gym deleted");
      res.json({ success: true, data: { gymId, status: "DELETED" } });
    }),
  );
  return r;
}
