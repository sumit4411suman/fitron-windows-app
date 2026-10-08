import { requirePermission } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { listRoles } from "@/lib/services/staff";
import { PageHeader } from "@/components/ui";
import { StaffForm } from "../staff-form";

export const metadata = { title: "Add staff · Fitron" };

export default async function NewStaff({ searchParams }: PageProps<"/staff/new">) {
  const u = await requirePermission("staff.manage");
  const [roles, branches] = await Promise.all([listRoles(), db.branch.findMany({ where: { orgId: u.orgId, active: true }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } })]);
  const want = (await searchParams).role;
  const defaultRole = typeof want === "string" ? roles.find((r) => r.name === want)?.id : undefined;
  return (
    <>
      <PageHeader title="Add staff" />
      <StaffForm roles={roles} branches={branches} defaultRole={defaultRole} />
    </>
  );
}
