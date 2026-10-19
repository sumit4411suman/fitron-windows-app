"use client";

import { ActionForm } from "@/components/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { createDecisionAction, updateDecisionAction } from "./actions";

const CATEGORIES = [
  ["PRICING", "Pricing change"],
  ["PROMOTION", "Promotion or offer"],
  ["HIRING", "Trainer or staff hiring"],
  ["EQUIPMENT", "Equipment purchase"],
  ["HOURS", "Operating hours"],
  ["OTHER", "Other"],
] as const;

export function DecisionForm({ decision }: { decision?: { id: string; title: string; category: string; objective: string; constraints: string | null; reviewDays: number } }) {
  return (
    <ActionForm action={decision ? updateDecisionAction.bind(null, decision.id) : createDecisionAction} submit={decision ? "Save as a new revision" : "Create the decision"} variant="primary">
      {(state) => (
        <>
          <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr]">
            <Field label="Title" error={state?.errors?.title}>
              <Input name="title" defaultValue={decision?.title} required maxLength={160} placeholder="e.g. Raise the monthly plan to ₹1,800" />
            </Field>
            <Field label="Category" error={state?.errors?.category}>
              <Select name="category" defaultValue={decision?.category ?? "PRICING"}>
                {CATEGORIES.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Review after (days)" hint="When projections are compared with the books" error={state?.errors?.reviewDays}>
              <Input type="number" name="reviewDays" min={14} max={365} defaultValue={decision?.reviewDays ?? 90} />
            </Field>
          </div>
          <Field label="Objective" hint="What this decision should achieve, in measurable terms where you can" error={state?.errors?.objective}>
            <Textarea name="objective" defaultValue={decision?.objective} required maxLength={2000} />
          </Field>
          <Field label="Constraints" hint="Budget, timing, staffing, anything that rules options out" error={state?.errors?.constraints}>
            <Textarea name="constraints" defaultValue={decision?.constraints ?? ""} maxLength={2000} />
          </Field>
        </>
      )}
    </ActionForm>
  );
}
