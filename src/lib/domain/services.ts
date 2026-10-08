// One-time add-ons from the pricing page ("Setup, branding and extras"): paid once, GST included. A gym buys
// them in Settings > Plan & billing; the payment is a numbered FITRON tax invoice like a plan payment.
//
// Fixed ones cost exactly `price`. Quoted ones start at `price`: FITRON agrees the scope first, and the gym pays
// the quoted amount (never less than the starting price).

export type ServiceDef = {
  key: string;
  name: string;
  /** Paise, GST included. */
  price: number;
  /** `price` is where a quote starts; the gym pays the amount agreed with FITRON. */
  quoted: boolean;
  /** SAC code printed on the invoice. Confirm with your accountant before relying on it. */
  sac: string;
};

export const SERVICES: readonly ServiceDef[] = [
  { key: "onboarding", name: "Gym onboarding and setup", price: 99_900, quoted: false, sac: "998313" },
  { key: "branding", name: "Custom gym branding", price: 4_99_900, quoted: false, sac: "998314" },
  { key: "data-migration", name: "Member data migration", price: 99_900, quoted: true, sac: "998313" },
  { key: "integration", name: "Custom integration", price: 99_900, quoted: true, sac: "998314" },
  { key: "mobile-app", name: "Branded mobile app", price: 9_99_900, quoted: true, sac: "998314" },
];

/** The most one add-on payment can be, in rupees: a typo should not become a charge. */
export const MAX_SERVICE_RUPEES = 10_00_000;

export const findService = (key: string | null | undefined) => SERVICES.find((s) => s.key === key);

/** What to charge for an add-on, in paise. Quoted add-ons take the agreed amount in whole rupees (not below the starting price). */
export function servicePaise(service: ServiceDef, rupees?: number | null): number {
  if (!service.quoted || rupees === undefined || rupees === null) return service.price;
  if (!Number.isInteger(rupees) || rupees <= 0) throw new Error("Enter the amount in whole rupees.");
  if (rupees > MAX_SERVICE_RUPEES) throw new Error(`The most one payment can be is ₹${MAX_SERVICE_RUPEES.toLocaleString("en-IN")}.`);
  const paise = rupees * 100;
  if (paise < service.price) throw new Error(`${service.name} starts at ₹${(service.price / 100).toLocaleString("en-IN")}.`);
  return paise;
}
