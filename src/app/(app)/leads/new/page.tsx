import { requirePermission } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { Card, PageHeader } from "@/components/ui";
import { LeadForm } from "../lead-form";

export const metadata = { title: "Add lead · Fitron" };

export default async function NewLead() {
  const u = await requirePermission("leads.manage");
  const [staff, plans] = await Promise.all([
    db.user.findMany({ where: { orgId: u.orgId, active: true, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.membershipPlan.findMany({ where: { orgId: u.orgId, status: "ACTIVE" }, select: { name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader title="Add lead" subtitle="Someone who enquired but hasn't joined yet." />
      <Card>
        <LeadForm staff={staff} interests={plans.map((p) => p.name)} meId={u.id} />
      </Card>
    </>
  );
}
