import { requirePermission } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { getTax } from "@/lib/services/tax";
import { todayIso } from "@/lib/services/time";
import { PageHeader } from "@/components/ui";
import { InvoiceForm } from "./invoice-form";

export const metadata = { title: "Create invoice · Fitron" };

export default async function NewInvoicePage({ searchParams }: PageProps<"/invoices/new">) {
  const u = await requirePermission("invoices.create");
  const { member } = await searchParams;
  const [members, tax] = await Promise.all([
    db.member.findMany({ where: { orgId: u.orgId, branchId: { in: u.branchIds }, deletedAt: null, walkIn: false }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true, phone: true } }),
    getTax(u.orgId),
  ]);
  return (
    <>
      <PageHeader title="Create invoice" subtitle="For personal training, products or other charges. Use Renew on a member's page for memberships." />
      <InvoiceForm
        members={members.map((m) => ({ id: m.id, label: `${m.name} · ${m.code} · ${m.phone}` }))}
        memberId={typeof member === "string" ? member : undefined}
        today={todayIso()}
        taxRate={tax.enabled ? tax.rate : 0}
      />
    </>
  );
}
