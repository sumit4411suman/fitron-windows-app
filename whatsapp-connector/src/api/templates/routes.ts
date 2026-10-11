import { Router } from "express";
import type { z } from "zod";
import type { Container } from "../../server/container.js";
import { gymAuth, gymOf } from "../../middleware/apiKeyAuth.js";
import { validateBody, wrap } from "../../middleware/validate.js";
import { renderTemplate, TEMPLATE_VARIABLES, type TemplateVars } from "../../services/TemplateService.js";
import { previewBody, templateBody } from "../schemas.js";

/** Per-gym message templates (built-in defaults until customised). */
export function templateRoutes(c: Container): Router {
  const r = Router();
  r.use(gymAuth(c.gyms));

  r.get(
    "/",
    wrap(async (req, res) => {
      const { gymId } = gymOf(req);
      res.json({ success: true, data: { variables: TEMPLATE_VARIABLES, templates: await c.templates.list(gymId) } });
    }),
  );
  r.post(
    "/preview",
    validateBody(previewBody),
    wrap(async (req, res) => {
      const { gymName } = gymOf(req);
      const b = req.body as z.infer<typeof previewBody>;
      res.json({ success: true, data: { text: renderTemplate(b.body, { gymName, ...(b.variables ?? {}) } as TemplateVars) } });
    }),
  );
  r.get(
    "/:name",
    wrap(async (req, res) => {
      const { gymId } = gymOf(req);
      res.json({ success: true, data: await c.templates.get(gymId, String(req.params.name)) });
    }),
  );
  r.put(
    "/:name",
    validateBody(templateBody),
    wrap(async (req, res) => {
      const { gymId } = gymOf(req);
      res.json({ success: true, data: await c.templates.upsert(gymId, String(req.params.name), req.body) });
    }),
  );
  r.delete(
    "/:name",
    wrap(async (req, res) => {
      const { gymId } = gymOf(req);
      res.json({ success: true, data: await c.templates.reset(gymId, String(req.params.name)) });
    }),
  );
  return r;
}
