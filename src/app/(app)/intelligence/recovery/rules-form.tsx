"use client";

import type { RecoveryRules } from "@/lib/domain/recovery";
import { ActionForm } from "@/components/action-form";
import { Field, Input } from "@/components/ui";
import { saveRulesAction } from "./actions";

/** Settings for the queue: when an invoice enters it, how long a lapse stays an opportunity, how often to follow up. */
export function RulesForm({ rules }: { rules: RecoveryRules }) {
  return (
    <ActionForm action={saveRulesAction} submit="Save rules" variant="default" className="flex flex-col gap-3">
      {(state) => (
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Grace days after the due date" hint="0 = the day after" error={state?.errors?.graceDays}>
            <Input type="number" name="graceDays" min={0} max={90} defaultValue={rules.graceDays} />
          </Field>
          <Field label="Smallest balance worth a case (₹)" error={state?.errors?.minBalance}>
            <Input name="minBalance" defaultValue={(rules.minBalance / 100).toString()} />
          </Field>
          <Field label="Renewal window (days after a plan ends)" error={state?.errors?.renewalWindowDays}>
            <Input type="number" name="renewalWindowDays" min={7} max={365} defaultValue={rules.renewalWindowDays} />
          </Field>
          <Field label="Days between follow-ups" error={state?.errors?.followUpEveryDays}>
            <Input type="number" name="followUpEveryDays" min={1} max={30} defaultValue={rules.followUpEveryDays} />
          </Field>
          <Field label="Suggest a call after this many attempts" error={state?.errors?.callAfterAttempts}>
            <Input type="number" name="callAfterAttempts" min={1} max={10} defaultValue={rules.callAfterAttempts} />
          </Field>
          <Field label="Suggest a review after this many attempts" error={state?.errors?.reviewAfterAttempts}>
            <Input type="number" name="reviewAfterAttempts" min={2} max={20} defaultValue={rules.reviewAfterAttempts} />
          </Field>
        </div>
      )}
    </ActionForm>
  );
}
