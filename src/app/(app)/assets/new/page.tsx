import { requirePermission } from "@/lib/auth/current";
import { Card, PageHeader } from "@/components/ui";
import { todayIso } from "@/lib/services/time";
import { AssetForm } from "../asset-forms";

export const metadata = { title: "Add asset · Fitron" };

export default async function NewAsset() {
  await requirePermission("assets.manage");
  return (
    <>
      <PageHeader title="Add asset" subtitle="For one item bought on its own. For a supplier bill with several lines, record a purchase instead." />
      <Card>
        <AssetForm today={todayIso()} />
      </Card>
    </>
  );
}
