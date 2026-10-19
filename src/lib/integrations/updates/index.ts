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

// ── The download link for websites (fitron.in/download/windows) ───────────

/** Where FITRON for Windows is published (docs/local-windows/RELEASE.md §2.4): the feed every installed FITRON reads. */
export const WINDOWS_FEED = "https://github.com/sumit4411suman/fitron-windows-app/releases/latest/download/latest.json";
/** The newest release's page, for when the feed cannot be read: the installer is listed there. */
export const WINDOWS_RELEASES = "https://github.com/sumit4411suman/fitron-windows-app/releases/latest";

/** FITRON_WINDOWS_FEED moves it, the same address as the release workflow's FITRON_UPDATE_URL when that is set. */
export const windowsFeed = (env: Record<string, string | undefined> = process.env) => serviceUrl(env.FITRON_WINDOWS_FEED) ?? WINDOWS_FEED;

export type Installer = { version: string; url: string };

const INSTALLER_FOR_MS = 5 * 60_000;
const cache = globalThis as unknown as { fitronWindowsInstaller?: { feed: string; at: number; installer: Installer } };

/**
 * The newest FITRON for Windows installer, as the update feed names it: an https address of an .exe on the feed's own
 * site, so the link can only ever lead to FITRON's own download. Kept for five minutes, so a busy download button asks
 * the feed at most that often. Asks nothing about anyone: the feed is a public file.
 */
export async function latestWindowsInstaller(now = Date.now()): Promise<ServiceAnswer<Installer>> {
  const feed = windowsFeed();
  const kept = cache.fitronWindowsInstaller;
  if (kept && kept.feed === feed && now - kept.at < INSTALLER_FOR_MS) return { ok: true, data: kept.installer };
  const r = await askService<{ version?: unknown; platforms?: Record<string, { url?: unknown } | undefined> }>("Finding the newest FITRON for Windows", feed, { method: "GET", timeoutMs: 8_000 });
  if (!r.ok) return r;
  const version = r.data.version;
  const url = r.data.platforms?.["windows-x86_64"]?.url;
  const refused = { ok: false as const, reason: "refused" as const, message: "The update feed does not name a FITRON for Windows installer." };
  if (typeof version !== "string" || !CODE.test(version) || typeof url !== "string") return refused;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return refused;
  }
  if (u.protocol !== "https:" || u.hostname !== new URL(feed).hostname || !u.pathname.toLowerCase().endsWith(".exe")) return refused;
  const installer = { version, url: u.toString() };
  cache.fitronWindowsInstaller = { feed, at: now, installer };
  return { ok: true, data: installer };
}
