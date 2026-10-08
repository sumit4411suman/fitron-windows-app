import { requirePermission } from "@/lib/auth/current";
import { Card, PageHeader } from "@/components/ui";
import { DietForm } from "../../program-forms";

export const metadata = { title: "Add diet · Fitron" };

export default async function NewDiet() {
  await requirePermission("programs.manage");
  return (
    <>
      <PageHeader title="Add diet" />
      <Card>
        <DietForm />
      </Card>
    </>
  );
}
