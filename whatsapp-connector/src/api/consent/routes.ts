import { Router } from "express";
import { z } from "zod";
import type { Container } from "../../server/container.js";
import { gymAuth, gymOf } from "../../middleware/apiKeyAuth.js";
import { validateBody, validateQuery, wrap } from "../../middleware/validate.js";
import { normalizePhone } from "../../utils/phoneNumber.js";
import { consentBody } from "../schemas.js";

const q = z.object({ phone: z.string().trim().optional(), memberId: z.string().trim().optional(), optedIn: z.enum(["true", "false"]).optional(), limit: z.coerce.number().int().min(1).max(500).optional() });

/** Opt-in / opt-out records for the calling gym. */
export function consentRoutes(c: Container): Router {
  const r = Router();
  r.use(gymAuth(c.gyms));

  const act = (kind: "optIn" | "optOut") =>
    wrap(async (req, res) => {
      const { gymId } = gymOf(req);
      const b = req.body as z.infer<typeof consentBody>;
      const phone = normalizePhone(b.phone, c.env.DEFAULT_COUNTRY).digits;
      const source = b.source ?? "api";
      const out = kind === "optIn" ? await c.consent.optIn(gymId, phone, source, b.memberId) : await c.consent.optOut(gymId, phone, source, b.memberId);
      res.json({ success: true, data: out });
    });
  r.post("/opt-in", validateBody(consentBody), act("optIn"));
  r.post("/opt-out", validateBody(consentBody), act("optOut"));

  r.get(
    "/",
    validateQuery(q),
    wrap(async (req, res) => {
      const { gymId } = gymOf(req);
      const query = res.locals.query as z.infer<typeof q>;
      if (query.phone) {
        const phone = normalizePhone(query.phone, c.env.DEFAULT_COUNTRY).digits;
        const one = await c.consent.get(gymId, phone);
        return res.json({ success: true, data: one ?? { phoneNumber: phone, whatsappOptIn: false, memberId: null, optInSource: null, optInAt: null, optOutSource: null, optOutAt: null, updatedAt: null } });
      }
      res.json({ success: true, data: await c.consent.list(gymId, { memberId: query.memberId, optedIn: query.optedIn === undefined ? undefined : query.optedIn === "true", limit: query.limit }) });
    }),
  );
  return r;
}
