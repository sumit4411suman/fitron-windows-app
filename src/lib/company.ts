// The business details shown on the public Contact page, from the same FITRON_LEGAL_NAME, FITRON_ADDRESS and
// FITRON_GSTIN settings that print on FITRON's invoices to gyms. Nothing is made up: only what has been set is
// shown. deploy/install.sh pre-fills the legal name, so a name on its own doesn't count (it may never have been
// confirmed); it is shown once an address or a GSTIN is set too.

export type PublicCompany = { name: string; address: string; gstin: string };

const clean = (v: string | undefined) => (v ?? "").replace(/\s+/g, " ").trim();

export function publicCompany(env: Record<string, string | undefined> = process.env): PublicCompany | null {
  const address = clean(env.FITRON_ADDRESS);
  const gstin = clean(env.FITRON_GSTIN).toUpperCase();
  if (!address && !gstin) return null;
  return { name: clean(env.FITRON_LEGAL_NAME) || "FITRON", address, gstin };
}
