import { Router } from "express";
import multer from "multer";
import type { Container } from "../../server/container.js";
import { gymAuth, gymOf } from "../../middleware/apiKeyAuth.js";
import { validateBody, validateQuery, wrap } from "../../middleware/validate.js";
import { renderTemplate, type TemplateVars } from "../../services/TemplateService.js";
import { normalizePhone } from "../../utils/phoneNumber.js";
import { documentBody, listQuery, sendBody } from "../schemas.js";
import type { z } from "zod";

/** Sending and reading messages for the calling gym. */
export function messageRoutes(c: Container): Router {
  const r = Router();
  r.use(gymAuth(c.gyms));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: c.env.MAX_MEDIA_BYTES, files: 1, fields: 10 } });

  r.post(
    "/send",
    validateBody(sendBody),
    wrap(async (req, res) => {
      const { gymId, gymName } = gymOf(req);
      const b = req.body as z.infer<typeof sendBody>;
      const gym = await c.gyms.get(gymId);
      const text = b.variables ? renderTemplate(b.message, { gymName, gymPhone: gym.phone ?? "", ...b.variables } as TemplateVars) : b.message;
      const { message, duplicate } = await c.messages.send({ gymId, to: b.to, message: text, category: b.category, memberId: b.memberId, idempotencyKey: b.idempotencyKey });
      res.status(duplicate ? 200 : 202).json({ success: true, messageId: message.messageId, data: { ...message, duplicate } });
    }),
  );

  const media = (kind: "document" | "image") =>
    wrap(async (req, res) => {
      const { gymId } = gymOf(req);
      const b = documentBody.parse(req.body ?? {});
      const file = req.file;
      if (!file) return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: 'Attach the file in the multipart field "file".' } });
      const mimeType = kind === "image" && !file.mimetype.startsWith("image/") ? "application/octet-stream" : file.mimetype;
      const { message, duplicate } = await c.messages.send({ gymId, to: b.to, message: b.caption, category: b.category, memberId: b.memberId, idempotencyKey: b.idempotencyKey, file: { buffer: file.buffer, mimeType, fileName: file.originalname } });
      res.status(duplicate ? 200 : 202).json({ success: true, messageId: message.messageId, data: { ...message, duplicate } });
    });
  r.post("/document", upload.single("file"), media("document"));
  r.post("/image", upload.single("file"), media("image"));

  r.get(
    "/",
    validateQuery(listQuery),
    wrap(async (req, res) => {
      const { gymId } = gymOf(req);
      const q = res.locals.query as z.infer<typeof listQuery>;
      let from = q.from ? new Date(q.from) : undefined;
      let to = q.to ? new Date(q.to) : undefined;
      if (q.date) {
        from = new Date(`${q.date}T00:00:00.000Z`);
        to = new Date(`${q.date}T23:59:59.999Z`);
      }
      const recipient = q.recipient ? normalizePhone(q.recipient, c.env.DEFAULT_COUNTRY).digits : undefined;
      const { items, nextCursor } = await c.messageLog.list(gymId, { status: q.status, messageType: q.messageType, recipient, memberId: q.memberId, ids: q.ids, idempotencyKeys: q.idempotencyKeys, from, to, limit: q.limit, cursor: q.cursor });
      res.json({ success: true, data: { items, nextCursor } });
    }),
  );

  r.get(
    "/:messageId",
    wrap(async (req, res) => {
      const { gymId } = gymOf(req);
      const m = await c.messageLog.get(gymId, String(req.params.messageId));
      res.json({ success: true, data: { ...m, messageId: m.id } });
    }),
  );

  r.post(
    "/:messageId/cancel",
    wrap(async (req, res) => {
      const { gymId } = gymOf(req);
      res.json({ success: true, data: await c.messages.cancel(gymId, String(req.params.messageId)) });
    }),
  );
  return r;
}
