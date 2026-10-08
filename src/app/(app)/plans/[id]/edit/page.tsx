import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/current";
import { getPlan } from "@/lib/services/plans";
import { PageHeader } from "@/components/ui";
import { PlanForm } from "../../plan-form";

export const metadata = { title: "Edit plan · Fitron" };

export default async function EditPlan({ params }: PageProps<"/plans/[id]/edit">) {
  const u = await requirePermission("plans.manage");
  const p = await getPlan(u, (await params).id);
  if (!p) notFound();
  return (
    <>
      <PageHeader title={`Edit ${p.name}`} />
      <PlanForm id={p.id} values={p} />
    </>
  );
}
