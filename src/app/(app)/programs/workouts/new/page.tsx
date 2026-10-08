import { requirePermission } from "@/lib/auth/current";
import { Card, PageHeader } from "@/components/ui";
import { WorkoutForm } from "../../program-forms";

export const metadata = { title: "Add workout · Fitron" };

export default async function NewWorkout() {
  await requirePermission("programs.manage");
  return (
    <>
      <PageHeader title="Add workout" />
      <Card>
        <WorkoutForm />
      </Card>
    </>
  );
}
