import "dotenv/config";
import { z } from "zod";

// Every setting the connector reads, validated once at startup. A missing or malformed value stops the process with a
// clear message instead of failing later in a request.

const bool = z
  .string()
  .optional()
  .transform((v) => (v ?? "false").trim().toLowerCase() === "true");
const int = (def: number, min = 0) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : Number(v)))
    .pipe(z.number().int().min(min));
const list = (def: string) =>
  z
    .string()
    .optional()
    .transform((v) =>
      (v ?? def)
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    );

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  RUN_MODE: z.enum(["api", "worker", "all"]).default("all"),
  PORT: int(3000, 1),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  WA_CONNECTOR_MASTER_KEY: z.string().min(16, "WA_CONNECTOR_MASTER_KEY must be at least 16 characters"),
  SESSION_ENCRYPTION_KEY: z.string().min(16, "SESSION_ENCRYPTION_KEY must be at least 16 characters"),
  // Which WhatsApp Web library holds the sessions: baileys (WebSocket, light) or wwebjs (whatsapp-web.js, headless Chromium).
  WA_ENGINE: z.enum(["baileys", "wwebjs"]).default("baileys"),
  // The Chromium whatsapp-web.js launches. Empty: Puppeteer's own download.
  CHROMIUM_PATH: z.string().default(""),
  SESSION_STORAGE_PATH: z.string().default("./data/whatsapp-sessions"),
  MEDIA_STORAGE_PATH: z.string().default("./data/media"),
  MAX_MESSAGES_PER_MINUTE: int(10, 1),
  MAX_MESSAGES_PER_HOUR: int(100, 1),
  MAX_MESSAGES_PER_DAY: int(500, 1),
  MAX_QUEUE_SIZE_PER_GYM: int(500, 1),
  MIN_SEND_GAP_MS: int(3000),
  MAX_SEND_GAP_MS: int(8000),
  MESSAGE_MAX_AGE_HOURS: int(24, 1),
  OFFLINE_RETRY_SECONDS: int(30, 1),
  WORKER_CONCURRENCY: int(4, 1),
  MAX_MEDIA_BYTES: int(10 * 1024 * 1024, 1024),
  OPT_OUT_KEYWORDS: list("STOP,UNSUBSCRIBE,CANCEL,OPTOUT,OPT OUT"),
  OPT_IN_KEYWORDS: list("START,SUBSCRIBE,OPTIN,OPT IN"),
  OPT_OUT_REPLY: z.string().default("You will no longer receive messages from us. Reply START to opt back in."),
  ALLOW_TRANSACTIONAL_AFTER_OPT_OUT: bool,
  REQUIRE_OPT_IN_FOR_TRANSACTIONAL: bool,
  DEFAULT_COUNTRY: z
    .string()
    .default("IN")
    .transform((s) => s.toUpperCase()),
  CORS_ORIGIN: z.string().default(""),
  PUBLIC_URL: z.string().default("http://localhost:3000"),
  API_RATE_LIMIT_PER_MINUTE: int(120, 1),
  QR_IDLE_MINUTES: int(5, 1),
  RECONNECT_GIVE_UP_MINUTES: int(30, 1),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Reads and validates process.env (once). Tests call resetEnv() after stubbing variables. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
    throw new Error(`Invalid environment configuration:\n  ${problems}`);
  }
  if (parsed.data.MAX_SEND_GAP_MS < parsed.data.MIN_SEND_GAP_MS) throw new Error("MAX_SEND_GAP_MS must be >= MIN_SEND_GAP_MS");
  cached = parsed.data;
  return cached;
}

export function resetEnv(): void {
  cached = null;
}
