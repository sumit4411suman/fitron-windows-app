import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { getLead } from "@/lib/services/leads";
import { toIso } from "@/lib/services/time";
import { Badge, Card, LinkButton, Notice, PageHeader } from "@/components/ui";
import { fmtDate, fmtStamp } from "@/lib/format";
import { LeadForm, LostButton, StageButton } from "../lead-form";
import { STAGE_TONE } from "../stage-tone";

export const metadata = { title: "Lead · Fitron" };

export default async function LeadPage({ params }: PageProps<"/leads/[id]">) {
  const u = await requirePermission("leads.manage");
  const { id } = await params;
  const lead = await getLead(u, id);
  if (!lead) notFound();
  const [staff, plans] = await Promise.all([
    db.user.findMany({ where: { orgId: u.orgId, active: true, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.membershipPlan.findMany({ where: { orgId: u.orgId, status: "ACTIVE" }, select: { name: true }, orderBy: { name: "asc" } }),
  ]);
  const closed = lead.stage === "Won" || lead.stage === "Lost";
  const d = (x: Date | null) => (x ? toIso(x) : null);

  return (
    <>
      <PageHeader
        title={lead.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={STAGE_TONE[lead.stage as keyof typeof STAGE_TONE] ?? "neutral"}>{lead.stage}</Badge>
            {lead.phone} · added {fmtStamp(lead.createdAt)}
            {lead.trialOn ? ` · trial ${fmtDate(d(lead.trialOn))}` : ""}
          </span>
        }
        actions={
          !closed && u.can("members.create") ? (
            <LinkButton href={`/members/new?lead=${lead.id}`} variant="primary">
              Convert to member
            </LinkButton>
          ) : undefined
        }
      />
      {lead.stage === "Won" && lead.member && (
        <Notice tone="ok">
          Joined as{" "}
          <Link href={`/members/${lead.member.id}`} className="underline">
            {lead.member.name} ({lead.member.code})
          </Link>
          .
        </Notice>
      )}
      {lead.stage === "Lost" && <Notice tone="alert">Lost: {lead.lostReason}</Notice>}
      {!closed && (
        <Card title="Next step" className="mb-6">
          <div className="flex flex-wrap items-start gap-2">
            {lead.stage === "New" && <StageButton id={lead.id} stage="Contacted" label="Mark contacted" primary />}
            {(lead.stage === "New" || lead.stage === "Contacted") && <StageButton id={lead.id} stage="Trial booked" label="Book trial (tomorrow)" />}
            {lead.stage === "Trial booked" && <StageButton id={lead.id} stage="Trial done" label="Trial done" primary />}
            <LostButton id={lead.id} />
          </div>
          <p className="mt-3 text-sm text-muted">Each step sets the next follow-up date. To change the trial date, edit it below.</p>
        </Card>
      )}
      <Card title="Details">
        <LeadForm
          id={lead.id}
          staff={staff}
          interests={plans.map((p) => p.name)}
          meId={u.id}
          values={{ name: lead.name, phone: lead.phone, source: lead.source, interest: lead.interest, followUpOn: d(lead.followUpOn), trialOn: d(lead.trialOn), ownerId: lead.ownerId, notes: lead.notes }}
        />
      </Card>
    </>
  );
}
