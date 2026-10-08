import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/current";
import { getDiet } from "@/lib/services/programs";
import { formatMeals } from "@/lib/validation/frontdesk";
import { Card, PageHeader } from "@/components/ui";
import { DietForm } from "../../program-forms";

export const metadata = { title: "Edit diet · Fitron" };

export default async function EditDiet({ params }: PageProps<"/programs/diets/[id]">) {
  const u = await requirePermission("programs.manage");
  const { id } = await params;
  const d = await getDiet(u, id);
  if (!d) notFound();
  return (
    <>
      <PageHeader title={`Edit ${d.name}`} subtitle="Members on this plan see the change straight away." />
      <Card>
        <DietForm id={d.id} values={{ name: d.name, kcal: String(d.kcal), protein: String(d.protein), meals: formatMeals(d.meals) }} />
      </Card>
    </>
  );
}
