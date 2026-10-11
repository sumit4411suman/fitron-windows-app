import pino from "pino";

// Structured JSON logs. Anything that could carry a secret, a QR payload or a message body is redacted by path.
// Code must still not put API keys, session credentials or QR data into log fields in the first place.

const level = process.env.LOG_LEVEL ?? "info";
const pretty = process.env.NODE_ENV === "development" && process.env.LOG_PRETTY !== "false";

export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "*.apiKey",
  "*.api_key",
  "*.masterKey",
  "*.password",
  "*.token",
  "*.qr",
  "*.qrData",
  "*.creds",
  "*.message",
  "*.body",
  "*.caption",
  "data.message",
  "data.qr",
  "payload.message",
  "payload.qr",
];

export const logger = pino({
  level,
  redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  base: { service: "wa-connector", mode: process.env.RUN_MODE ?? "all" },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(pretty ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } } } : {}),
});

export type Logger = typeof logger;
