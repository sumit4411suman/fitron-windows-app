// Structured logging: one JSON line per event, so `docker compose logs app` can be searched ("grep request.error")
// and so an error shown to a user as a reference (its digest) can be found. Use this instead of console.*;
// observability.test.ts fails if a console call comes back.
//
// Log the event and the error, never the data that caused it: member details, form contents, tokens and
// passwords do not belong in a log line. Field names that look like secrets are dropped as a last defence.

export type Level = "info" | "warn" | "error";
export type Fields = Record<string, string | number | boolean | null | undefined>;

const MAX_TEXT = 500;
const STACK_FRAMES = 6;
const RESERVED = new Set(["time", "level", "event"]);
const SECRET_KEY = /pass|token|secret|cookie|authorization|credential|api[-_]?key/i;

const cut = (s: string) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s);

/** What to record about a caught error: its kind, message, the first stack frames, and its code and digest when it has them. */
export function errorFields(e: unknown): Fields {
  if (typeof e !== "object" || e === null) return { errorName: "NonError", errorMessage: cut(String(e)) };
  const x = e as { name?: unknown; message?: unknown; stack?: unknown; code?: unknown; digest?: unknown };
  const out: Fields = {
    errorName: typeof x.name === "string" ? x.name : "Error",
    errorMessage: typeof x.message === "string" ? cut(x.message) : undefined,
  };
  if (typeof x.stack === "string") {
    const frames = x.stack.split("\n").filter((l) => l.trimStart().startsWith("at ")).slice(0, STACK_FRAMES);
    if (frames.length) out.stack = frames.map((l) => l.trim()).join("\n");
  }
  if (typeof x.code === "string" || typeof x.code === "number") out.code = x.code;
  if (typeof x.digest === "string") out.digest = x.digest;
  return out;
}

/** The line that is written: time, level and event first, then the fields. Pure, so it can be tested. */
export function format(level: Level, event: string, fields: Fields = {}, now = new Date()): string {
  const clean: Fields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || RESERVED.has(k) || SECRET_KEY.test(k)) continue;
    clean[k] = typeof v === "string" ? cut(v) : v;
  }
  return JSON.stringify({ time: now.toISOString(), level, event, ...clean });
}

function write(level: Level, event: string, fields?: Fields) {
  if (process.env.NODE_ENV === "test") return;
  const line = format(level, event, fields);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

const withError = (err: unknown, fields?: Fields): Fields => ({ ...fields, ...(err === undefined ? {} : errorFields(err)) });

export const log = {
  info: (event: string, fields?: Fields) => write("info", event, fields),
  warn: (event: string, err?: unknown, fields?: Fields) => write("warn", event, withError(err, fields)),
  error: (event: string, err?: unknown, fields?: Fields) => write("error", event, withError(err, fields)),
};
