// FITRON for Windows listens on 127.0.0.1 only, so only programs on this computer reach it. A web page on the internet
// can still try, through the browser on this computer, by pointing its own name at 127.0.0.1 ("DNS rebinding"). Such a
// request names the page's website in its Host header, so the Local Edition answers only requests addressed to this
// computer by its own names (src/proxy.ts).

/** True when a Host header names this computer: 127.0.0.1 (any 127.x), localhost, or ::1, with or without a port. */
export function isLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const h = host.trim().toLowerCase();
  const name = h.startsWith("[") ? h.slice(1, h.indexOf("]")) : h.replace(/:\d+$/, "");
  if (h.startsWith("[") && !/^\[[^\]]+\](:\d+)?$/.test(h)) return false;
  if (!h.startsWith("[") && !/^[^:]+(:\d+)?$/.test(h)) return false;
  return name === "localhost" || name === "::1" || /^127(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(name);
}
