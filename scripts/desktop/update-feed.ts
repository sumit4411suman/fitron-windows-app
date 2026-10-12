// The update feed FITRON for Windows reads (Tauri's static JSON format, docs/local-windows/UPDATES.md): one small file
// at FITRON_UPDATE_URL naming the newest version, where its installer is, and FITRON's signature over that installer.

export type UpdateFeed = {
  version: string;
  notes: string;
  pub_date: string;
  platforms: { "windows-x86_64": { url: string; signature: string } };
};

const VERSION = /^\d+\.\d+\.\d+$/;

/** The installer's name as customers download it. */
export const installerName = (version: string) => `FITRON-Gym-Accounting-Setup-${version}.exe`;

/** The tag a release is published under on GitHub Releases. */
export const releaseTag = (version: string) => `v${version}`;

// GitHub Releases serves the newest published release's files at …/releases/latest/download/<file>.
const GITHUB_LATEST = /^(\/[^/]+\/[^/]+\/releases\/)latest\/download\/[^/]+\.json$/;

/** Where the installer of `version` is served, given the feed's address. */
function installerUrl(feed: URL, version: string): string {
  const gh = feed.hostname === "github.com" ? GITHUB_LATEST.exec(feed.pathname) : null;
  // On GitHub, the feed is always the newest release's, but the installer it names is pinned to its own release, so a
  // FITRON reading the feed just before a newer release is published still downloads the version it was told about.
  if (gh) return new URL(`${gh[1]}download/${releaseTag(version)}/${installerName(version)}`, feed).toString();
  return new URL(installerName(version), feed).toString();
}

/**
 * The feed for one release. `feedUrl` is where the feed itself is served (FITRON_UPDATE_URL, built into FITRON); the
 * installer is served beside it (on GitHub Releases, in the same release), so the two can never point at different places.
 */
export function updateFeed(o: { version: string; notes: string; feedUrl: string; signature: string; date: Date }): UpdateFeed {
  if (!VERSION.test(o.version)) throw new Error(`Not a release version: ${o.version}`);
  const feed = new URL(o.feedUrl);
  if (feed.protocol !== "https:") throw new Error(`The update address must be https: ${o.feedUrl}`);
  if (!feed.pathname.endsWith(".json")) throw new Error(`The update address must name the feed file (…/latest.json): ${o.feedUrl}`);
  const signature = o.signature.trim();
  if (!signature) throw new Error("The installer's signature is empty. Build the release with FITRON's signing key (TAURI_SIGNING_PRIVATE_KEY).");
  return {
    version: o.version,
    notes: o.notes.trim(),
    pub_date: o.date.toISOString().replace(/\.\d{3}Z$/, "Z"),
    platforms: { "windows-x86_64": { url: installerUrl(feed, o.version), signature } },
  };
}
