import "server-only";

// Who counts as the FITRON team: the people who may open /fitron-admin (FITRON_ADMIN_EMAILS, comma separated).

const env = (k: string) => process.env[k]?.trim() || "";

/** Emails of the FITRON team. */
export const fitronAdmins = () =>
  env("FITRON_ADMIN_EMAILS")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

export const isFitronAdmin = (email: string) => fitronAdmins().includes(email.toLowerCase());
