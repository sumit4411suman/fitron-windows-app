import { requirePermission } from "@/lib/auth/current";
import { AUDIENCES, audienceCounts, type Audience } from "@/lib/services/audience";
import { getWaSettings } from "@/lib/services/whatsapp";
import { Notice } from "@/components/ui";
import { CampaignForm } from "../wa-forms";
import { WaHeader } from "../wa-header";

export const metadata = { title: "New campaign · Fitron" };

export default async function SendPage() {
  const u = await requirePermission("whatsapp.send");
  const [counts, s] = await Promise.all([audienceCounts(u), getWaSettings(u.orgId)]);
  return (
    <div className="flex flex-col gap-6 pt-4">
      <WaHeader u={u} current="/whatsapp/send" />
      {s.mode === "connector" && <Notice tone="alert">The linked phone sends one message every 8–15 seconds, up to 250 a day. Message only members who expect to hear from you, or WhatsApp may restrict the number.</Notice>}
      <section className="flex max-w-2xl flex-col gap-3 rounded-lg bg-surface p-5">
        <h3 className="text-lg">Send WhatsApp message</h3>
        <p className="m-0 text-sm text-muted">One message to many members. Each gets their own name and dates.</p>
        <CampaignForm audiences={(Object.keys(AUDIENCES) as Audience[]).map((k) => ({ key: k, label: AUDIENCES[k], count: counts[k] }))} />
      </section>
    </div>
  );
}
