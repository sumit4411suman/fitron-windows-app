import { notFound } from "next/navigation";
import { isLocal } from "@/lib/runtime/edition";
import { findPlan } from "@/lib/domain/pricing";
import { CLAIM, INSTALLATION_ID, WINDOWS_PLANS, windowsBranches } from "@/lib/domain/windows-licence";
import { fitronKeyId } from "@/lib/integrations/razorpay";
import { Notice } from "@/components/ui";
import { SideLogo } from "@/components/side-logo";
import { BuyForm, type PlanChoice } from "./buy-form";

export const metadata = { title: "Buy FITRON for Windows · Fitron", robots: { index: false } };
export const dynamic = "force-dynamic";

// fitron.in/windows/buy: where the owner of a FITRON for Windows computer pays for its licence (src/lib/services/
// windows-licence.ts). Opened from Settings › Licence on that computer, which puts its installation id and a one-time
// claim in the address; the licence is then collected by that computer alone. Not part of FITRON for Windows itself.
export default async function BuyWindowsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (isLocal()) notFound();
  const sp = await searchParams;
  const installationId = typeof sp.i === "string" ? sp.i : "";
  const claim = typeof sp.c === "string" ? sp.c : "";
  const valid = INSTALLATION_ID.test(installationId) && CLAIM.test(claim);
  const plans: PlanChoice[] = WINDOWS_PLANS.map((key) => {
    const p = findPlan(key)!;
    return { key, name: p.name, tagline: p.tagline, price: { MONTHLY: p.price.MONTHLY, YEARLY: p.price.YEARLY }, branches: windowsBranches(key), memberLimit: "memberLimit" in p ? (p.memberLimit ?? null) : null };
  });
  const wanted = typeof sp.p === "string" && (WINDOWS_PLANS as readonly string[]).includes(sp.p) ? sp.p : "professional";
  return (
    <div className="min-h-screen bg-bg">
      <header className="flex items-center gap-4 border-b border-line-soft px-4 py-3 lg:px-10">
        <SideLogo />
      </header>
      <main className="mx-auto flex max-w-[860px] flex-col gap-5 px-4 py-8">
        <div>
          <p className="m-0 text-xs tracking-[0.14em] text-muted uppercase">FITRON Gym Accounting for Windows</p>
          <h1 className="m-0 mt-1 text-[28px] font-semibold">Buy or renew your licence</h1>
          <p className="m-0 mt-2 text-sm text-muted">
            The same plans as FITRON online, for the gym&apos;s own Windows computer. Prices include 18% GST. The licence is made for the computer this page was opened from, and FITRON installs it there by itself.
          </p>
        </div>
        {valid ? (
          <BuyForm installationId={installationId} claim={claim} plans={plans} initialPlan={wanted} demo={fitronKeyId() === null} />
        ) : (
          <Notice tone="alert">Open this page from FITRON on the gym&apos;s computer: Settings › Licence › Buy or renew. The link from there names the computer the licence is for.</Notice>
        )}
        <p className="m-0 text-xs text-muted">
          Nothing about your members or books is sent to FITRON: only the computer&apos;s installation id, and the name, email, phone and GSTIN you type here for the licence and receipt. Questions: hello@fitron.in.
        </p>
      </main>
    </div>
  );
}
