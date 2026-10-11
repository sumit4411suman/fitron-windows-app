import "server-only";
import { askService, serviceUrl, type ServiceAnswer } from "../service";

// FITRON for Windows' update feed. The desktop shell downloads and checks the signed installer (Phase 18, with a backup
// before it installs); this file only asks whether there is a newer version, to say so in the app. The question carries
// the edition, the version, the update channel and the kind of Windows: nothing about the gym or its data.
//
// FITRON_UPDATE_URL is the feed (https). Unset, the app says updates are not set up and keeps working.

export const UPDATE_FIELDS = ["edition", "version", "channel", "platform"] as const;
export type UpdateQuery = Record<(typeof UPDATE_FIELDS)[number], string>;
export type Release = { version: string; notes: string; publishedAt: string | null };

const CODE = /^[A-Za-z0-9._-]{1,64}$/;

/** The feed address with the allowed fields only, each a short code. Throws on anything else. */
export function updateQueryString(q: Record<string, unknown>): string {
  const extra = Object.keys(q).filter((k) => !(UPDATE_FIELDS as readonly string[]).includes(k));
  if (extra.length) throw new Error(`Not sent to the update feed: ${extra.join(", ")}. Only ${UPDATE_FIELDS.join(", ")} may be sent.`);
  const params = new URLSearchParams();
  for (const k of UPDATE_FIELDS) {
    const v = q[k];
    if (typeof v !== "string" || !CODE.test(v)) throw new Error(`The update question needs ${k} as a short code.`);
    params.set(k, v);
  }
  return params.toString();
}

export const updateFeed = (env: Record<string, string | undefined> = process.env) => serviceUrl(env.FITRON_UPDATE_URL);

/** The newest release for this edition and channel, or why it could not be asked. Never throws for "offline". */
export async function latestRelease(q: UpdateQuery): Promise<ServiceAnswer<Release>> {
  const query = updateQueryString(q);
  const base = updateFeed();
  if (!base) return { ok: false, reason: "not-configured", message: "Updates are not set up for this installation." };
  const r = await askService<{ version?: unknown; notes?: unknown; pub_date?: unknown }>("Checking for FITRON updates", `${base}?${query}`, { method: "GET", then: "FITRON keeps working on this version and checks again later." });
  if (!r.ok) return r;
  const v = r.data;
  if (typeof v.version !== "string" || !CODE.test(v.version)) return { ok: false, reason: "refused", message: "The update feed did not name a version." };
  return { ok: true, data: { version: v.version, notes: typeof v.notes === "string" ? v.notes.slice(0, 4000) : "", publishedAt: typeof v.pub_date === "string" ? v.pub_date : null } };
}
