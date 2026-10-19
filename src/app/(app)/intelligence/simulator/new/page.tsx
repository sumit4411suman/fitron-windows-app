import { requirePermission } from "@/lib/auth/current";
import { baselineInputs } from "@/lib/services/simulator";
import { fmtDate, formatRupees } from "@/lib/format";
import { Notice } from "@/components/ui";
import { IntelligenceShell, SIM_NOTE } from "../../_ui";
import { ScenarioEditor } from "../scenario-editor";
import { saveScenarioAction } from "../actions";

export const metadata = { title: "New scenario · Fitron" };

export default async function NewScenarioPage() {
  const u = await requirePermission("accounting.view");
  const b = await baselineInputs(u);
  return (
    <IntelligenceShell u={u} current="/intelligence/simulator" title="New scenario" subtitle={`Starting from your books: ${b.snapshot.activeMembers} active members, revenue of ${formatRupees(b.snapshot.revenue)} and operating expenses of ${formatRupees(b.snapshot.expenses)} from ${fmtDate(b.from)} to ${fmtDate(b.to)}. Change any assumption; the forecast updates at once.`}>
      <Notice tone="neutral">
        {b.notes.join(" ")} {SIM_NOTE}
      </Notice>
      <ScenarioEditor inputs={b.inputs} baseline={b.inputs} save={saveScenarioAction.bind(null, null)} />
    </IntelligenceShell>
  );
}
