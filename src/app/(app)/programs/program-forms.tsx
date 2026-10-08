"use client";

import { useActionState } from "react";
import { saveDietAction, saveWorkoutAction } from "./actions";
import { Button, Field, Input, LinkButton, Notice, Select, Textarea } from "@/components/ui";

type Values = Partial<Record<string, string | null>>;

function useForm(act: (s: Awaited<ReturnType<typeof saveWorkoutAction>>, fd: FormData) => ReturnType<typeof saveWorkoutAction>, values: Values) {
  const [state, action, pending] = useActionState(act, undefined);
  const sent = state?.values;
  return { state, action, pending, e: state?.errors ?? {}, v: (k: string) => (sent ? (sent[k] as string | undefined) : (values[k] ?? undefined)) };
}

export function WorkoutForm({ id, values = {} }: { id?: string; values?: Values }) {
  const { state, action, pending, e, v } = useForm(saveWorkoutAction.bind(null, id ?? null), values);
  return (
    <form action={action} key={state?.nonce} className="flex flex-col gap-4">
      {state?.message && <Notice tone="alert">{state.message}</Notice>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={e.name}>
          <Input name="name" defaultValue={v("name")} required />
        </Field>
        <Field label="Goal" error={e.goal}>
          <Input name="goal" defaultValue={v("goal")} placeholder="Weight loss, muscle gain…" required />
        </Field>
        <Field label="Level" error={e.level}>
          <Select name="level" defaultValue={v("level") ?? "Beginner"}>
            <option>Beginner</option>
            <option>Intermediate</option>
            <option>Advanced</option>
          </Select>
        </Field>
        <Field label="Weeks" error={e.weeks}>
          <Input name="weeks" type="number" min={1} max={104} defaultValue={v("weeks") ?? "4"} required />
        </Field>
        <Field label="Days and exercises" error={e.days} className="sm:col-span-2" hint="A line without “|” starts a new day. Each exercise is “name | sets × reps”.">
          <Textarea name="days" rows={14} defaultValue={v("days") ?? "Day A\nGoblet squat | 3 × 12\nLat pulldown | 3 × 12\n\nDay B\nLeg press | 3 × 12\nSeated row | 3 × 12"} className="font-mono text-sm" required />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button variant="primary" disabled={pending}>
          {pending ? "Saving…" : id ? "Save changes" : "Add workout"}
        </Button>
        <LinkButton href="/programs">Cancel</LinkButton>
      </div>
    </form>
  );
}

export function DietForm({ id, values = {} }: { id?: string; values?: Values }) {
  const { state, action, pending, e, v } = useForm(saveDietAction.bind(null, id ?? null), values);
  return (
    <form action={action} key={state?.nonce} className="flex flex-col gap-4">
      {state?.message && <Notice tone="alert">{state.message}</Notice>}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Name" error={e.name}>
          <Input name="name" defaultValue={v("name")} required />
        </Field>
        <Field label="Calories a day" error={e.kcal}>
          <Input name="kcal" type="number" min={500} max={8000} defaultValue={v("kcal")} required />
        </Field>
        <Field label="Protein (g)" error={e.protein}>
          <Input name="protein" type="number" min={0} max={500} defaultValue={v("protein")} required />
        </Field>
        <Field label="Meals" error={e.meals} className="sm:col-span-3" hint="One meal per line: “Breakfast | Poha with peanuts, 2 boiled eggs”.">
          <Textarea name="meals" rows={8} defaultValue={v("meals") ?? "Breakfast | \nMid-morning | \nLunch | \nEvening | \nDinner | "} className="font-mono text-sm" required />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button variant="primary" disabled={pending}>
          {pending ? "Saving…" : id ? "Save changes" : "Add diet"}
        </Button>
        <LinkButton href="/programs?tab=diets">Cancel</LinkButton>
      </div>
    </form>
  );
}
