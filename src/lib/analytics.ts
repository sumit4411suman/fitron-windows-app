// Google Analytics is optional and off unless GA_MEASUREMENT_ID is set. Even then, public/site/analytics.js sends nothing
// until a visitor has agreed to analytics in the cookie choices.

/** The GA4 measurement ID from the environment ("G-XXXXXXXXXX"), or null if none is set or it does not look right. */
export function analyticsId(env: Record<string, string | undefined> = process.env): string | null {
  const v = env.GA_MEASUREMENT_ID?.trim();
  return v && /^G-[A-Z0-9]{4,}$/.test(v) ? v : null;
}
