import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/current";
import { getSlot, trainers } from "@/lib/services/classes";
import { Card, PageHeader } from "@/components/ui";
import { ClassForm } from "../../class-forms";

export const metadata = { title: "Edit class · Fitron" };

export default async function EditClass({ params }: PageProps<"/classes/[id]/edit">) {
  const u = await requirePermission("classes.manage");
  const { id } = await params;
  const s = await getSlot(u, id);
  if (!s) notFound();
  return (
    <>
      <PageHeader title={`Edit ${s.name}`} subtitle="Changes apply to every week, including sessions already booked." />
      <Card>
        <ClassForm id={s.id} trainers={await trainers(u)} values={{ name: s.name, trainerId: s.trainerId, weekday: String(s.weekday), startTime: s.startTime, durationMin: String(s.durationMin), capacity: String(s.capacity), room: s.room }} />
      </Card>
    </>
  );
}
