import { requirePermission } from "@/lib/auth/current";
import { trainers } from "@/lib/services/classes";
import { Card, PageHeader } from "@/components/ui";
import { ClassForm } from "../class-forms";

export const metadata = { title: "Add class · Fitron" };

export default async function NewClass() {
  const u = await requirePermission("classes.manage");
  return (
    <>
      <PageHeader title="Add class" subtitle="A class repeats every week on the same day and time." />
      <Card>
        <ClassForm trainers={await trainers(u)} />
      </Card>
    </>
  );
}
