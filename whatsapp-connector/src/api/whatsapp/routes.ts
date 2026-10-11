import { Router, type Request, type Response } from "express";
import type { Container } from "../../server/container.js";
import { gymAuth, gymOf } from "../../middleware/apiKeyAuth.js";
import { wrap } from "../../middleware/validate.js";
import { formatPhone } from "../../utils/phoneNumber.js";
import type { SessionEvent } from "../../types/index.js";

export const SSE_HEARTBEAT_MS = 25_000;

/** Session lifecycle for the calling gym: connect (QR), status, events stream, disconnect. */
export function whatsappRoutes(c: Container): Router {
  const r = Router();
  r.use(gymAuth(c.gyms));

  r.post(
    "/connect",
    wrap(async (req, res) => {
      const { gymId } = gymOf(req);
      if (!(await c.sessions.workerRunning())) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "The WhatsApp worker is not running. Check the worker container." } });
      }
      const status = await c.sessions.connect(gymId);
      res.json({ success: true, status, data: { status, eventsUrl: "/api/v1/whatsapp/events" } });
    }),
  );

  r.get(
    "/status",
    wrap(async (req, res) => {
      const { gymId } = gymOf(req);
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      const [s, stats, usage] = await Promise.all([c.sessions.status(gymId), c.messageLog.stats(gymId, since), c.rateLimit.usage(gymId)]);
      const connected = s.status === "CONNECTED";
      res.json({
        success: true,
        connected,
        status: s.status,
        phone: s.phone ? "+" + s.phone : null,
        data: { connected, status: s.status, phone: s.phone ? "+" + s.phone : null, phoneFormatted: s.phone ? formatPhone(s.phone) : null, connectedAt: s.connectedAt, lastSeenAt: s.lastSeenAt, error: s.lastError, workerRunning: s.workerRunning, today: { sent: stats.sentToday, failed: stats.failedToday }, queued: stats.queued, usage, limits: { perMinute: c.env.MAX_MESSAGES_PER_MINUTE, perHour: c.env.MAX_MESSAGES_PER_HOUR, perDay: c.env.MAX_MESSAGES_PER_DAY, queue: c.env.MAX_QUEUE_SIZE_PER_GYM } },
      });
    }),
  );

  /** One-shot QR fetch for clients that cannot use the events stream. Prefer /events. */
  r.get(
    "/qr",
    wrap(async (req, res) => {
      const { gymId } = gymOf(req);
      await c.sessions.markWatched(gymId);
      const [s, qr] = await Promise.all([c.sessions.status(gymId), c.sessions.currentQr(gymId)]);
      if (s.status !== "QR_REQUIRED" && s.status !== "CONNECTING") return res.json({ success: true, data: { status: s.status, qr: null } });
      if (!qr) return res.status(410).json({ success: false, error: { code: "QR_EXPIRED", message: "No QR code is available right now; a new one is on its way. Listen on /events or try again in a few seconds." } });
      res.json({ success: true, data: { status: s.status, qr: qr.dataUrl, expiresAt: qr.expiresAt } });
    }),
  );

  r.post(
    "/disconnect",
    wrap(async (req, res) => {
      const { gymId } = gymOf(req);
      const logout = (req.body as { logout?: boolean } | undefined)?.logout !== false;
      await c.sessions.disconnect(gymId, logout);
      c.logger.info({ gymId, logout }, "whatsapp disconnect requested");
      res.json({ success: true, data: { status: "DISCONNECTED", loggedOut: logout } });
    }),
  );

  r.get("/events", (req, res) => void sse(c, req, res));
  return r;
}

/** Server-Sent Events: current status at once, then QR codes, status changes and message updates as they happen. */
async function sse(c: Container, req: Request, res: Response): Promise<void> {
  const { gymId } = gymOf(req);
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const write = (e: SessionEvent) => {
    res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  };

  await c.sessions.markWatched(gymId);
  const [s, qr] = await Promise.all([c.sessions.status(gymId), c.sessions.currentQr(gymId)]);
  write({ type: "status", data: { status: s.status, phone: s.phone ? "+" + s.phone : null, error: s.lastError } });
  if (qr && (s.status === "QR_REQUIRED" || s.status === "CONNECTING")) write({ type: "qr", data: qr.dataUrl, expiresAt: qr.expiresAt });

  const unsubscribe = await c.sessions.subscribe(gymId, (e) => {
    if (e.type === "status") write({ type: "status", data: { ...e.data, phone: e.data.phone ? "+" + e.data.phone.replace(/^\+/, "") : null } });
    else write(e);
  });
  const timer = setInterval(() => {
    write({ type: "heartbeat", data: { at: new Date().toISOString() } });
    c.sessions.markWatched(gymId).catch(() => undefined);
  }, SSE_HEARTBEAT_MS);

  req.on("close", () => {
    clearInterval(timer);
    unsubscribe();
    res.end();
  });
}
