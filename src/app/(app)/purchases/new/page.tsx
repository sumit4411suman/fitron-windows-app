import { requirePermission, writeBranch } from "@/lib/auth/current";
import { stockProducts, vendorNames } from "@/lib/services/purchases";
import { listCategories } from "@/lib/services/expenses";
import { Card, Notice, PageHeader } from "@/components/ui";
import { todayIso } from "@/lib/services/time";
import { PurchaseForm } from "../purchase-forms";

export const metadata = { title: "New purchase · Fitron" };

export default async function NewPurchase({ searchParams }: PageProps<"/purchases/new">) {
  const u = await requirePermission("purchases.manage");
  const { type } = await searchParams;
  const branchId = writeBranch(u);
  if (!branchId)
    return (
      <>
        <PageHeader title="New purchase" />
        <Notice>Pick a branch in the header first. A bill belongs to one branch.</Notice>
      </>
    );
  const [products, categories, vendors] = await Promise.all([stockProducts(u, branchId), listCategories(), vendorNames(u)]);
  const start = type === "ASSET" || type === "EXPENSE" ? type : "STOCK";
  return (
    <>
      <PageHeader title="New purchase" subtitle="One supplier bill. Each line can be stock, equipment or an expense." />
      <Card>
        <PurchaseForm products={products} categories={categories} vendors={vendors} today={todayIso()} startType={start} />
      </Card>
    </>
  );
}
