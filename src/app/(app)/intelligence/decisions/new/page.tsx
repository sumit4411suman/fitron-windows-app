import { requirePermission } from "@/lib/auth/current";
import { Card } from "@/components/ui";
import { IntelligenceShell } from "../../_ui";
import { DecisionForm } from "../decision-form";

export const metadata = { title: "New decision · Fitron" };

export default async function NewDecisionPage() {
  const u = await requirePermission("accounting.view");
  return (
    <IntelligenceShell u={u} current="/intelligence/decisions" title="New decision" subtitle="The books as they stand today become the decision's baseline, and a do-nothing option is added from them. You add the options to compare next.">
      <Card>
        <DecisionForm />
      </Card>
    </IntelligenceShell>
  );
}
