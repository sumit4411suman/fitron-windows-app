import "server-only";
import { getSetting } from "./settings";

export type TaxSetting = {
  enabled: boolean;
  /** GST percent, e.g. 18 */
  rate: number;
  /** CGST+SGST inside the gym's state, IGST otherwise. */
  type: "CGST+SGST" | "IGST";
  sac?: string;
  /** The gym's GST registration, printed under its name on invoices. A branch's own GSTIN wins. */
  gstin?: string;
};

export const DEFAULT_TAX: TaxSetting = { enabled: true, rate: 18, type: "CGST+SGST", sac: "999723" };

export async function getTax(orgId: string): Promise<TaxSetting> {
  return { ...DEFAULT_TAX, ...((await getSetting<Partial<TaxSetting>>(orgId, "tax")) ?? {}) };
}
