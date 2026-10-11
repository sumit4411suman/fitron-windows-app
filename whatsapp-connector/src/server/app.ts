import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { gymRoutes } from "../api/auth/routes.js";
import { consentRoutes } from "../api/consent/routes.js";
import { openApiDocument } from "../api/docs/openapi.js";
import { fitronRoutes } from "../api/fitron/routes.js";
import { healthRoutes } from "../api/health/routes.js";
import { messageRoutes } from "../api/messages/routes.js";
import { templateRoutes } from "../api/templates/routes.js";
import { whatsappRoutes } from "../api/whatsapp/routes.js";
import { errorHandler, notFound } from "../middleware/errorHandler.js";
import { apiRateLimiter } from "../middleware/rateLimiter.js";
import { requestLogger } from "../middleware/requestLogger.js";
import type { Container } from "./container.js";

export function createApp(c: Container): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // behind nginx
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  const origins = c.env.CORS_ORIGIN.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  app.use(cors({ origin: origins.length ? origins : false, methods: ["GET", "POST", "PUT", "PATCH", "DELETE"], allowedHeaders: ["Authorization", "Content-Type", "X-Request-Id"], exposedHeaders: ["X-Request-Id", "RateLimit", "RateLimit-Policy"], maxAge: 600 }));
  app.use(express.json({ limit: "256kb" }));
  app.use(express.urlencoded({ extended: false, limit: "64kb" }));
  app.use(requestLogger);

  app.use(healthRoutes(c));
  const doc = openApiDocument(c.env.PUBLIC_URL);
  app.get("/openapi.json", (_req, res) => res.json(doc));
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(doc, { customSiteTitle: "Fitron WhatsApp Connector API" }));

  const api = express.Router();
  api.use(apiRateLimiter(c.env.API_RATE_LIMIT_PER_MINUTE));
  api.use("/gyms", gymRoutes(c));
  api.use("/whatsapp", whatsappRoutes(c));
  api.use("/messages", messageRoutes(c));
  api.use("/consent", consentRoutes(c));
  api.use("/templates", templateRoutes(c));
  api.use("/fitron", fitronRoutes(c));
  app.use("/api/v1", api);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
