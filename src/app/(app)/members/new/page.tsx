import { requirePermission } from "@/lib/auth/current";
import { listTrainers } from "@/lib/services/staff";
import { getLead } from "@/lib/services/leads";
import { PageHeader } from "@/components/ui";
import { MemberForm } from "../member-form";

export const metadata = { title: "Add member · Fitron" };

export default async function NewMember({ searchParams }: PageProps<"/members/new">) {
  const u = await requirePermission("members.create");
  const { lead: leadId } = await searchParams;
  const lead = typeof leadId === "string" && u.can("leads.manage") ? await getLead(u, leadId) : null;
  const values = lead && lead.stage !== "Won" ? { leadId: lead.id, name: lead.name, phone: lead.phone, whatsapp: lead.phone, source: lead.source, notes: lead.notes } : undefined;
  return (
    <>
      <PageHeader title="Add member" subtitle={values ? `From lead ${lead!.name}. The lead is marked won when you save.` : "The member ID is assigned when you save."} />
      <MemberForm trainers={await listTrainers(u)} values={values} />
    </>
  );
}
