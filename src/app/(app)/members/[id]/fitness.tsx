"use client";

import { useActionState } from "react";
import { assignAction, recordAction } from "../fitness-actions";
import { Button, Field, Input, Notice, Select } from "@/components/ui";

export function AssignForm({ memberId, trainers, workouts, diets, trainerId, workoutId, dietId }: { memberId: string; trainers: { id: string; name: string }[]; workouts: { id: string; name: string }[]; diets: { id: string; name: string }[]; trainerId: string | null; workoutId: string | null; dietId: string | null }) {
  const [state, action, pending] = useActionState(assignAction.bind(null, memberId), undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      {state?.message && <Notice tone={state.ok ? "ok" : "alert"}>{state.message}</Notice>}
      <Field label="Trainer">
        <Select name="trainerId" defaultValue={trainerId ?? ""}>
          <option value="">No trainer</option>
          {trainers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Workout plan">
        <Select name="workoutPlanId" defaultValue={workoutId ?? ""}>
          <option value="">None</option>
          {workouts.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Diet plan">
        <Select name="dietPlanId" defaultValue={dietId ?? ""}>
          <option value="">None</option>
          {diets.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      </Field>
      <div>
        <Button disabled={pending}>Save program</Button>
      </div>
    </form>
  );
}

export function RecordForm({ memberId, today }: { memberId: string; today: string }) {
  const [state, action, pending] = useActionState(recordAction.bind(null, memberId), undefined);
  const e = state?.errors ?? {};
  const sent = state?.ok ? undefined : (state?.values as Record<string, string> | undefined);
  return (
    <form action={action} key={state?.nonce} className="flex flex-col gap-3">
      {state?.message && <Notice tone={state.ok ? "ok" : "alert"}>{state.message}</Notice>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Lift" error={e.lift}>
          <Input name="lift" placeholder="Bench press" maxLength={60} defaultValue={sent?.lift} required />
        </Field>
        <Field label="Weight (kg)" error={e.weightKg}>
          <Input name="weightKg" inputMode="decimal" defaultValue={sent?.weightKg} />
        </Field>
        <Field label="Reps" error={e.reps}>
          <Input name="reps" type="number" min={1} max={100} defaultValue={sent?.reps ?? "1"} />
        </Field>
        <Field label="Date" error={e.date}>
          <Input name="date" type="date" max={today} defaultValue={sent?.date ?? today} />
        </Field>
      </div>
      <div>
        <Button disabled={pending}>Add record</Button>
      </div>
    </form>
  );
}
