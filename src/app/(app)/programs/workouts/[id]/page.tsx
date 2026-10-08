import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/current";
import { getWorkout } from "@/lib/services/programs";
import { formatWorkoutDays } from "@/lib/validation/frontdesk";
import { Card, PageHeader } from "@/components/ui";
import { WorkoutForm } from "../../program-forms";

export const metadata = { title: "Edit workout · Fitron" };

export default async function EditWorkout({ params }: PageProps<"/programs/workouts/[id]">) {
  const u = await requirePermission("programs.manage");
  const { id } = await params;
  const w = await getWorkout(u, id);
  if (!w) notFound();
  return (
    <>
      <PageHeader title={`Edit ${w.name}`} subtitle="Members on this plan see the change straight away." />
      <Card>
        <WorkoutForm id={w.id} values={{ name: w.name, goal: w.goal, level: w.level, weeks: String(w.weeks), days: formatWorkoutDays(w.days) }} />
      </Card>
    </>
  );
}
