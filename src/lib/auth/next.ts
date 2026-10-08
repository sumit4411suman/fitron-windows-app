/** Where to go after signing in: only paths on this site, never another host. */
export function safeNext(raw: unknown, fallback = "/dashboard") {
  const s = typeof raw === "string" ? raw.trim() : "";
  // Browsers drop tabs and newlines and read a backslash as "/" when resolving a URL, so "/\t/evil.com"
  // would become "//evil.com". Refuse any control character, whitespace or backslash.
  if (!s.startsWith("/") || s.startsWith("//") || /[\u0000-\u0020\u007f\\]/.test(s)) return fallback;
  if (s === "/" || s.startsWith("/login")) return fallback;
  return s;
}
