"use client";

import type { SimInputs } from "@/lib/domain/simulator";
import type { Criterion } from "@/lib/services/decisions";
import { ActionForm } from "@/components/action-form";
import { Card, Field, Input, Select, Textarea } from "@/components/ui";
import { ScenarioEditor } from "../../simulator/scenario-editor";
import { implementAction, reviewAction, saveOptionAction, verdictAction } from "../actions";

type Option = { id: string; name: string; description: string | null; inputs: SimInputs; scores: Record<string, number>; benefits: string | null; costs: string | null; risks: string | null };

/** An option is a Profit Simulator scenario plus the owner's scores and words; the editor is the simulator's own. */
export function OptionEditor({ decisionId, option, baseline, criteria }: { decisionId: string; option: Option | null; baseline: SimInputs; criteria: Criterion[] }) {
  const scored = criteria.filter((c) => c.key !== "financial");
  return (
    <ScenarioEditor
      inputs={option?.inputs ?? baseline}
      baseline={baseline}
      name={option?.name ?? ""}
      note={option?.description ?? ""}
      save={saveOptionAction.bind(null, decisionId, option?.id ?? null)}
      saveLabel={option ? "Save the option" : "Add the option"}
      extra={
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            {scored.map((c) => (
              <Field key={c.key} label={`${c.label} (1–5, your judgement)`}>
                <Select name={`score.${c.key}`} defaultValue={option?.scores[c.key] ?? ""}>
                  <option value="">Not scored</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
          </div>
          <Field label="Expected benefits">
            <Input name="benefits" defaultValue={option?.benefits ?? ""} maxLength={2000} />
          </Field>
          <Field label="Costs beyond the figures">
            <Input name="costs" defaultValue={option?.costs ?? ""} maxLength={2000} />
          </Field>
          <Field label="Risks and uncertainty">
            <Input name="risks" defaultValue={option?.risks ?? ""} maxLength={2000} />
          </Field>
        </div>
      }
    />
  );
}

/** The owner's steps: approve / reject / defer, then record the go-live date, then the review. */
export function VerdictForms({ decision, today, reviewReady }: { decision: { id: string; status: string; selectedId: string | null; options: { id: string; name: string }[]; implementedOn: string | null }; today: string; reviewReady: boolean }) {
  const open = ["DRAFT", "APPROVED", "REJECTED", "DEFERRED"].includes(decision.status);
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {open && (
        <Card title="Your verdict" className="lg:col-span-2">
          <ActionForm action={verdictAction.bind(null, decision.id)} submit="Record the verdict" variant="primary">
            {(state) => (
              <>
                <div className="grid gap-3 md:grid-cols-3">
                  <Field label="Verdict" error={state?.errors?.verdict}>
                    <Select name="verdict" defaultValue={decision.status === "APPROVED" ? "APPROVED" : "APPROVED"}>
                      <option value="APPROVED">Approve</option>
                      <option value="REJECTED">Reject</option>
                      <option value="DEFERRED">Defer</option>
                    </Select>
                  </Field>
                  <Field label="Chosen option (for approval)" error={state?.errors?.optionId}>
                    <Select name="optionId" defaultValue={decision.selectedId ?? ""}>
                      <option value="">—</option>
                      {decision.options.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Deferred until (for deferral)" error={state?.errors?.deferredUntil}>
                    <Input type="date" name="deferredUntil" min={today} />
                  </Field>
                </div>
                <Field label="Reasoning" hint="What the review will be judged against" error={state?.errors?.rationale}>
                  <Textarea name="rationale" required minLength={5} maxLength={4000} />
                </Field>
              </>
            )}
          </ActionForm>
        </Card>
      )}
      {decision.status === "APPROVED" && (
        <Card title="Implemented">
          <ActionForm action={implementAction.bind(null, decision.id)} submit="Record implementation" variant="default">
            {(state) => (
              <Field label="The day it went live" error={state?.errors?.implementedOn}>
                <Input type="date" name="implementedOn" max={today} defaultValue={today} required />
              </Field>
            )}
          </ActionForm>
        </Card>
      )}
      {decision.status === "IMPLEMENTED" && (
        <Card title="Record the review" className="lg:col-span-3">
          <p className="mb-3 text-sm text-muted">{reviewReady ? "Write what was learnt; the figures above are kept with the decision." : "The review period is still running; you can record it now with the figures so far, or wait."}</p>
          <ActionForm action={reviewAction.bind(null, decision.id)} submit="Record the review" variant="primary">
            {(state) => (
              <Field label="Lessons learnt" error={state?.errors?.lessons}>
                <Textarea name="lessons" maxLength={4000} />
              </Field>
            )}
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
