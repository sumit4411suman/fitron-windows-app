"use client";

import { useActionState } from "react";
import { saveMember } from "./actions";
import { Button, Card, Field, Input, LinkButton, Notice, Select, Textarea } from "@/components/ui";
import { Avatar, memberPhotoUrl } from "@/components/avatar";
import { CONSENT_LABEL, GENDERS, SOURCES } from "@/lib/validation/member";
import { fmtStamp } from "@/lib/format";

type Values = Partial<Record<string, string | null>>;

export function MemberForm({ id, values = {}, trainers }: { id?: string; values?: Values; trainers: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(saveMember.bind(null, id ?? null), undefined);
  const e = state?.errors ?? {};
  const sent = state?.values;
  const v = (k: string) => (sent ? (sent[k] as string | undefined) : (values[k] ?? undefined));

  return (
    <form action={action} key={state?.nonce} className="flex flex-col gap-4">
      {state?.message && <Notice tone="alert">{state.message}</Notice>}
      {values.leadId && <input type="hidden" name="leadId" value={values.leadId} />}
      <Card>
        <div className="grid gap-x-3.5 gap-y-3.5 sm:grid-cols-3">
          <Field label="Full name" error={e.name} className="sm:col-span-3">
            <Input name="name" defaultValue={v("name")} required />
          </Field>

          <Field label="Mobile number" error={e.phone}>
            <Input name="phone" type="tel" inputMode="numeric" defaultValue={v("phone")} required />
          </Field>

          <Field label="WhatsApp number" error={e.whatsapp} hint="Leave empty if same as mobile">
            <Input name="whatsapp" type="tel" inputMode="numeric" defaultValue={v("whatsapp")} />
          </Field>

          <Field label="Gender" error={e.gender}>
            <Select name="gender" defaultValue={v("gender") ?? ""} required>
              <option value="" disabled>
                Choose
              </option>
              {GENDERS.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </Select>
          </Field>

          <Field label="Date of birth" error={e.dob}>
            <Input name="dob" type="date" defaultValue={v("dob")} />
          </Field>

          <Field label="Email" error={e.email}>
            <Input name="email" type="email" defaultValue={v("email")} />
          </Field>

          <Field label="Occupation" error={e.occupation}>
            <Input name="occupation" defaultValue={v("occupation")} />
          </Field>

          <Field label="House / flat no." error={e.house}>
            <Input name="house" defaultValue={v("house")} />
          </Field>

          <Field label="Area" error={e.area}>
            <Input name="area" defaultValue={v("area")} />
          </Field>

          <Field label="City" error={e.city}>
            <Input name="city" defaultValue={v("city")} />
          </Field>

          <Field label="State" error={e.state}>
            <Input name="state" defaultValue={v("state")} />
          </Field>

          <Field label="PIN code" error={e.pin}>
            <Input name="pin" inputMode="numeric" defaultValue={v("pin")} />
          </Field>

          <Field label="How did you hear about us?" error={e.source}>
            <Select name="source" defaultValue={v("source") ?? ""} required>
              <option value="" disabled>
                Choose
              </option>
              {SOURCES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </Field>

          <Field label="Emergency contact name" error={e.emergencyName}>
            <Input name="emergencyName" defaultValue={v("emergencyName")} />
          </Field>

          <Field label="Relationship" error={e.emergencyRelation}>
            <Input name="emergencyRelation" defaultValue={v("emergencyRelation")} />
          </Field>

          <Field label="Emergency phone" error={e.emergencyPhone}>
            <Input name="emergencyPhone" type="tel" inputMode="numeric" defaultValue={v("emergencyPhone")} />
          </Field>

          <Field label="Trainer" error={e.trainerId}>
            <Select name="trainerId" defaultValue={v("trainerId") ?? ""}>
              <option value="">No trainer</option>
              {trainers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Tags" error={e.tags} hint="Separate with commas">
            <Input name="tags" defaultValue={v("tags")} />
          </Field>

          <Field label="Photo" hint="JPG, PNG or WebP, up to 5 MB. Optional." error={e.photo}>
            <div className="flex flex-wrap items-center gap-3">
              {values.photoKey && id && <Avatar name={values.name ?? ""} src={memberPhotoUrl(id, values.photoKey)} className="size-16 text-xl" />}
              <input type="file" name="photo" accept="image/jpeg,image/png,image/webp" className="max-w-full text-sm" />
            </div>
            {values.photoKey && id && (
              <label className="mt-1 flex items-center gap-2 text-sm">
                <input type="checkbox" name="removePhoto" /> Remove photo
              </label>
            )}
          </Field>

          <Field label="Notes" error={e.notes} className="sm:col-span-3">
            <Textarea name="notes" defaultValue={v("notes")} />
          </Field>

          <Field label="Internal staff notes" error={e.staffNotes} className="sm:col-span-3">
            <Textarea name="staffNotes" defaultValue={v("staffNotes")} />
          </Field>

          <Field label="Privacy consent" error={e.consent} className="sm:col-span-3" hint={id ? undefined : "Required. Read the notice to the member or show it to them on the screen."}>
            {values.consentAt ? (
              <p className="m-0 text-sm">Consent given on {fmtStamp(new Date(values.consentAt))}.</p>
            ) : (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="consent" defaultChecked={sent?.consent === "on"} required={!id} className="mt-0.5 size-4" />
                <span>{CONSENT_LABEL}</span>
              </label>
            )}
          </Field>
        </div>
      </Card>
      <div className="flex gap-2">
        <Button variant="primary" disabled={pending}>
          {pending ? "Saving…" : id ? "Save changes" : "Add member"}
        </Button>
        <LinkButton href={id ? `/members/${id}` : "/members"}>Cancel</LinkButton>
      </div>
    </form>
  );
}
