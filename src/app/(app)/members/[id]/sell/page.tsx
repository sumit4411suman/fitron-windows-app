import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/current";
import { getMember } from "@/lib/services/members";
import { listPlans } from "@/lib/services/plans";
import { suggestedStart } from "@/lib/services/billing";
import { getTax } from "@/lib/services/tax";
import { getReminderSettings } from "@/lib/services/whatsapp";
import { defaultPlanFor } from "@/lib/domain/membership";
import { Empty, PageHeader } from "@/components/ui";
import { MemberStatus } from "@/components/status";
import { fmtDate } from "@/lib/format";
import { SellForm } from "./sell-form";

export const metadata = { title: "Sell membership · Fitron" };

export default async function SellPage({ params }: PageProps<"/members/[id]/sell">) {
  const u = await requirePermission("memberships.renew");
  const { id } = await params;
  const m = await getMember(u, id);
  if (!m) notFound();
  const [plans, { start, isNew }, tax, { defaultMonths }] = await Promise.all([listPlans(u, { activeOnly: true }), suggestedStart(m.id), getTax(u.orgId), getReminderSettings(u.orgId)]);
  return (
    <>
      <PageHeader
        title={isNew ? `New membership for ${m.name}` : `Renew ${m.name.split(" ")[0]}’s membership`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {m.code} · {m.planName ? `${m.planName} until ${fmtDate(m.latestEnd)}` : "No membership yet"} <MemberStatus status={m.status} />
          </span>
        }
      />
      {plans.length === 0 ? (
        <Empty>There are no active plans. Create one under Plans &amp; offers first.</Empty>
      ) : (
        <SellForm memberId={m.id} member={{ gender: m.gender, tags: m.tags, occupation: m.occupation }} plans={plans} defaultPlanId={plans.find((p) => p.name === m.planName)?.id ?? defaultPlanFor(plans, defaultMonths)?.id} defaultStart={start} isNew={isNew} taxRate={tax.enabled ? tax.rate : 0} />
      )}
    </>
  );
}
