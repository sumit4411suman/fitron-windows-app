import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { getStaff, listRoles } from "@/lib/services/staff";
import { PageHeader } from "@/components/ui";
import { StaffForm } from "../../staff-form";

export const metadata = { title: "Change role · Fitron" };

export default async function EditStaff({ params }: PageProps<"/staff/[id]/edit">) {
  const u = await requirePermission("staff.manage");
  const s = await getStaff(u, (await params).id);
  if (!s) notFound();
  const [roles, branches] = await Promise.all([listRoles(), db.branch.findMany({ where: { orgId: u.orgId }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, active: true } })]);
  const held = new Set(s.branches.map((b) => b.branchId));
  const shown = branches.filter((b) => b.active || held.has(b.id));
  return (
    <>
      <PageHeader kicker={s.name} title="Change role" />
      <StaffForm id={s.id} values={{ ...s, branchIds: s.branches.map((b) => b.branchId) }} roles={roles} branches={shown} />
    </>
  );
}
