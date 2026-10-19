import { isLocal } from "@/lib/runtime/edition";
import { latestWindowsInstaller, WINDOWS_RELEASES } from "@/lib/integrations/updates";

// fitron.in/download/windows: the newest FITRON for Windows installer, the address for every "Download for Windows"
// button, on fitron.in or any other website. It follows the update feed every installed FITRON reads, so it moves to a
// new version the moment that version is published, and the button never needs changing. If the feed cannot be read,
// it opens the newest release's page, where the installer is listed. Not part of FITRON for Windows itself.

export const dynamic = "force-dynamic";

export async function GET() {
  if (isLocal()) return new Response("Not found", { status: 404 });
  const r = await latestWindowsInstaller();
  return new Response(null, { status: 302, headers: { location: r.ok ? r.data.url : WINDOWS_RELEASES, "cache-control": "no-store" } });
}
