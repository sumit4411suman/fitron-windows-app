import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/current";
import { getAsset } from "@/lib/services/assets";
import { Card, PageHeader } from "@/components/ui";
import { todayIso, toIso } from "@/lib/services/time";
import { AssetForm, RemoveAsset } from "../../asset-forms";

export const metadata = { title: "Edit asset · Fitron" };

const rupees = (n: number) => String(n / 100);

export default async function EditAsset({ params }: PageProps<"/assets/[id]/edit">) {
  const u = await requirePermission("assets.manage");
  const { id } = await params;
  const a = await getAsset(u, id);
  if (!a || a.status !== "IN_USE") notFound();
  const fromPurchase = !!a.purchaseId;
  return (
    <>
      <PageHeader title={`Edit ${a.code}`} subtitle="Corrections recalculate depreciation from the purchase month." />
      <Card>
        <AssetForm
          id={a.id}
          today={todayIso()}
          fromPurchase={fromPurchase}
          values={{
            name: a.name,
            category: a.category,
            qty: String(a.qty),
            purchaseDate: toIso(a.purchaseDate),
            cost: rupees(a.cost),
            salvage: rupees(a.salvage),
            method: a.method,
            rate: a.rate == null ? "" : String(Number(a.rate)),
            life: a.life == null ? "" : String(a.life),
            payMethod: fromPurchase ? `Purchase ${a.purchase?.code ?? ""}` : (a.payMethod ?? "none"),
            vendor: a.vendor ?? "",
            billNo: a.billNo ?? "",
            serial: a.serial ?? "",
            notes: a.notes ?? "",
          }}
        />
      </Card>
      {!fromPurchase && (
        <Card title="Added by mistake?" className="mt-6">
          <RemoveAsset id={a.id} />
        </Card>
      )}
    </>
  );
}
