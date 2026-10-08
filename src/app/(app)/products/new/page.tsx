import { requirePermission } from "@/lib/auth/current";
import { PRODUCT_CATEGORIES } from "@/lib/services/pos";
import { Card, PageHeader } from "@/components/ui";
import { ProductForm } from "../product-forms";

export const metadata = { title: "Add product · Fitron" };

export default async function NewProduct() {
  await requirePermission("products.manage");
  return (
    <>
      <PageHeader title="Add product" subtitle="Stock starts at zero. Receive stock on the product page." />
      <Card>
        <ProductForm categories={PRODUCT_CATEGORIES} />
      </Card>
    </>
  );
}
