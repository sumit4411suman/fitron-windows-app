import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { GymProfile } from "./settings";
import { DEFAULT_TAX, type TaxSetting } from "./tax";

type Client = Prisma.TransactionClient | typeof db;
type BranchBits = { gstin: string | null; address: string; phone: string };

/**
 * Who issued an invoice, as printed under "From". Written once into Invoice.seller when the invoice is made, so a later
 * change in Settings › Gym profile or › Tax never alters an old invoice.
 */
export type InvoiceSeller = {
  name: string;
  tagline?: string;
  address?: string;
  phone?: string;
  email?: string;
  /** The registration the invoice was raised under: the branch's own, else the gym's. Null when the gym had none. */
  gstin: string | null;
  sac?: string;
  instagram?: string;
  logoKey?: string | null;
};

const clean = (s: string | null | undefined) => s?.trim() || undefined;

/** The snapshot from a profile, a branch and the tax settings. Pure, so the page and the test can build one without a database. */
export function buildSeller(profile: Partial<GymProfile> & { name: string }, branch: BranchBits, tax: Pick<TaxSetting, "gstin" | "sac">): InvoiceSeller {
  return {
    name: profile.name,
    tagline: clean(profile.tagline),
    // The gym profile wins for address and phone; a branch's own GST registration wins over the gym-level one (as before).
    address: clean(profile.address) ?? clean(branch.address),
    phone: clean(profile.phone) ?? clean(branch.phone),
    email: clean(profile.email),
    gstin: clean(branch.gstin) ?? clean(tax.gstin) ?? null,
    sac: clean(tax.sac),
    instagram: clean(profile.instagram),
    logoKey: profile.logoKey ?? null,
  };
}

/** The seller as the settings stand right now. Reads through `client` so it works inside the invoice's own transaction. */
export async function sellerFor(client: Client, orgId: string, branch: BranchBits, tax?: Pick<TaxSetting, "gstin" | "sac">): Promise<InvoiceSeller> {
  const rows = await client.setting.findMany({ where: { orgId, key: { in: ["gym", "tax"] } } });
  const gym = (rows.find((r) => r.key === "gym")?.value as Partial<GymProfile> | null) ?? {};
  const t = tax ?? { ...DEFAULT_TAX, ...((rows.find((r) => r.key === "tax")?.value as Partial<TaxSetting> | null) ?? {}) };
  const name = gym.name?.trim() || (await client.organization.findUniqueOrThrow({ where: { id: orgId }, select: { name: true } })).name;
  return buildSeller({ ...gym, name }, branch, t);
}

/** The stored snapshot, or (for invoices made before it was kept) the live settings, which is all that was ever printed on them. */
export async function sellerOf(inv: { orgId: string; seller: Prisma.JsonValue | null; branch: BranchBits }): Promise<InvoiceSeller> {
  const s = inv.seller;
  if (s && typeof s === "object" && !Array.isArray(s) && typeof (s as { name?: unknown }).name === "string") {
    const o = s as Partial<InvoiceSeller> & { name: string };
    return { ...o, gstin: o.gstin ?? null };
  }
  return sellerFor(db, inv.orgId, inv.branch);
}
