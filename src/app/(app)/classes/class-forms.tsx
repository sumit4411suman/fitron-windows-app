"use client";

import { useActionState } from "react";
import { PlusIcon } from "@phosphor-icons/react";
import { bookAction, saveClass } from "./actions";
import { Button, Field, Input, LinkButton, Notice, Select } from "@/components/ui";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
type Values = Partial<Record<string, string | null>>;

export function ClassForm({ id, values = {}, trainers }: { id?: string; values?: Values; trainers: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(saveClass.bind(null, id ?? null), undefined);
  const e = state?.errors ?? {};
  const sent = state?.values;
  const v = (k: string) => (sent ? (sent[k] as string | undefined) : (values[k] ?? undefined));
  return (
    <form action={action} key={state?.nonce} className="flex flex-col gap-4">
      {state?.message && <Notice tone="alert">{state.message}</Notice>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Class name" error={e.name}>
          <Input name="name" defaultValue={v("name")} placeholder="HIIT, Yoga, Zumba…" required />
        </Field>
        <Field label="Trainer" error={e.trainerId}>
          <Select name="trainerId" defaultValue={v("trainerId") ?? ""} required>
            <option value="" disabled>
              Choose
            </option>
            {trainers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Day" error={e.weekday}>
          <Select name="weekday" defaultValue={v("weekday") ?? "0"}>
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Start time" error={e.startTime}>
          <Input name="startTime" type="time" defaultValue={v("startTime") ?? "06:30"} required />
        </Field>
        <Field label="Duration (min)" error={e.durationMin}>
          <Input name="durationMin" type="number" min={10} max={240} defaultValue={v("durationMin") ?? "45"} required />
        </Field>
        <Field label="Places" error={e.capacity}>
          <Input name="capacity" type="number" min={1} max={500} defaultValue={v("capacity") ?? "15"} required />
        </Field>
        <Field label="Room (optional)" error={e.room}>
          <Input name="room" defaultValue={v("room")} />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button variant="primary" disabled={pending}>
          {pending ? "Saving…" : id ? "Save changes" : "Add class"}
        </Button>
        <LinkButton href={id ? `/classes/${id}` : "/classes"}>Cancel</LinkButton>
      </div>
    </form>
  );
}

export function BookForm({ slotId, date, members, full }: { slotId: string; date: string; members: { id: string; label: string }[]; full: boolean }) {
  const [state, action, pending] = useActionState(bookAction.bind(null, slotId, date), undefined);
  return (
    <form action={action} key={state?.nonce} className="flex flex-col gap-2">
      {state?.message && <Notice tone={state.ok ? "ok" : "alert"}>{state.message}</Notice>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input name="member" list="book-members" placeholder="Member ID or name" aria-label="Member" autoComplete="off" required />
        <datalist id="book-members">
          {members.map((m) => (
            <option key={m.id} value={m.label} />
          ))}
        </datalist>
        <Button variant="primary" disabled={pending}>
          {full ? "Add to waitlist" : "Book"}
        </Button>
      </div>
    </form>
  );
}

/** The session panel's "Choose member… / Book place" row (prototype): active members not yet in this session. */
export function SessionBook({ slotId, date, members, full }: { slotId: string; date: string; members: { code: string; name: string }[]; full: boolean }) {
  const [state, action, pending] = useActionState(bookAction.bind(null, slotId, date), undefined);
  return (
    <form action={action} key={state?.nonce} className="flex flex-col gap-2">
      {state?.message && <Notice tone={state.ok ? "ok" : "alert"}>{state.message}</Notice>}
      <div className="flex flex-wrap items-center gap-2">
        <Select name="member" defaultValue="" aria-label="Member" required className="max-w-[300px] flex-[1_1_200px]">
          <option value="" disabled>
            Choose member…
          </option>
          {members.map((m) => (
            <option key={m.code} value={m.code}>
              {m.name} · {m.code}
            </option>
          ))}
        </Select>
        <Button variant="primary" disabled={pending}>
          <PlusIcon size={16} weight="duotone" />
          {full ? "Add to waitlist" : "Book place"}
        </Button>
      </div>
    </form>
  );
}
