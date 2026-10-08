import { requirePermission } from "@/lib/auth/current";
import { addDays } from "@/lib/domain/dates";
import { todayIso } from "@/lib/services/time";
import { ListHeader } from "@/components/ui";
import { OfferForm } from "./offer-form";

export const metadata = { title: "New offer · Fitron" };

export default async function NewOfferPage() {
  await requirePermission("plans.manage");
  return (
    <div className="flex max-w-xl flex-col gap-6 pt-4">
      <ListHeader kicker="Plans & offers" title="New offer code" />
      <OfferForm validTill={addDays(todayIso(), 30)} />
    </div>
  );
}
