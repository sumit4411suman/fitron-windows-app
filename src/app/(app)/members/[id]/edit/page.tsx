import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/current";
import { getMember } from "@/lib/services/members";
import { listTrainers } from "@/lib/services/staff";
import { PageHeader } from "@/components/ui";
import { MemberForm } from "../../member-form";

export const metadata = { title: "Edit member · Fitron" };

export default async function EditMember({ params }: PageProps<"/members/[id]/edit">) {
  const u = await requirePermission("members.edit");
  const { id } = await params;
  const m = await getMember(u, id);
  if (!m) notFound();
  const values = {
    ...Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === "string" ? v : null])),
    dob: m.dob ? m.dob.toISOString().slice(0, 10) : null,
    tags: m.tags.join(", "),
  };
  return (
    <>
      <PageHeader title={`Edit ${m.name}`} subtitle={m.code} />
      <MemberForm id={m.id} values={values} trainers={await listTrainers(u)} />
    </>
  );
}
