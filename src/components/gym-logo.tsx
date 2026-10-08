/** The URL of the gym's uploaded logo; it changes with the file, so browsers never show a stale one. */
export const gymLogoUrl = (logoKey: string | null | undefined) =>
  logoKey ? `/settings/logo?v=${encodeURIComponent(logoKey.split("/").pop() ?? "")}` : null;

export const DEFAULT_LOGO = "/fitron-logo.png";
