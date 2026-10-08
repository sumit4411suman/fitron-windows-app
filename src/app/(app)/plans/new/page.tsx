import { requirePermission } from "@/lib/auth/current";
import { PageHeader } from "@/components/ui";
import { PlanForm } from "../plan-form";
import { getReminderSettings } from "@/lib/services/whatsapp";

export const metadata = { title: "New plan · Fitron" };

export default async function NewPlan() {
  const u = await requirePermission("plans.manage");
  const { defaultMonths } = await getReminderSettings(u.orgId);
  return (
    <>
      <PageHeader title="New plan" />
      <PlanForm defaultMonths={defaultMonths} />
    </>
  );
}
