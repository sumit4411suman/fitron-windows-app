"use client";

import { METHODS } from "@/lib/validation/billing";
import { ActionButton, ActionForm } from "@/components/action-form";
import { Card, Field, Input, Select } from "@/components/ui";
import { closeCaseAction, logAttemptAction, recordPaymentAction, reopenCaseAction, sendReminderAction } from "../actions";

/** What can be done about a case, each through the same path the rest of FITRON uses (reminders, Collect payment). */
export function CaseActions({ id, kind, open, closed, balance, today, canWhatsApp, canCollect }: { id: string; kind: string; open: boolean; closed: boolean; balance: number; today: string; canWhatsApp: boolean; canCollect: boolean }) {
  if (!open) {
    return closed ? (
      <Card title="Reopen">
        <p className="mb-3 text-sm text-muted">A closed case stays closed through refreshes. Reopen it if the member comes back to it.</p>
        <ActionButton action={reopenCaseAction.bind(null, id)} label="Reopen the case" />
      </Card>
    ) : null;
  }
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card title={kind === "DUES" ? "Remind on WhatsApp" : "Renewal message on WhatsApp"}>
        <p className="mb-3 text-sm text-muted">{kind === "DUES" ? "The gym's balance-reminder template, under Settings › Reminders (de-duplication, quiet hours, demo mode)." : "The renewal template for how long ago the plan ended."}</p>
        {canWhatsApp ? <ActionButton action={sendReminderAction.bind(null, id)} label="Send now" variant="primary" /> : <p className="text-sm text-muted">Your role can&apos;t send WhatsApp messages.</p>}
      </Card>
      <Card title="Record a call, visit or note">
        <ActionForm action={logAttemptAction.bind(null, id)} submit="Record" variant="default" reset>
          {(state) => (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="What" error={state?.errors?.kind}>
                  <Select name="kind" defaultValue="CALL">
                    <option value="CALL">Call</option>
                    <option value="VISIT">Visit at the desk</option>
                    <option value="NOTE">Note</option>
                  </Select>
                </Field>
                <Field label="Outcome" error={state?.errors?.outcome}>
                  <Select name="outcome" defaultValue="NO_ANSWER">
                    <option value="NO_ANSWER">No answer</option>
                    <option value="PROMISED">Promised to pay / renew</option>
                    <option value="REFUSED">Refused</option>
                    <option value="NOTED">Just a note</option>
                  </Select>
                </Field>
                <Field label="Promised by" hint="For a promise" error={state?.errors?.promisedOn}>
                  <Input type="date" name="promisedOn" min={today} />
                </Field>
                <Field label="Promised amount (₹)" error={state?.errors?.promisedAmount}>
                  <Input name="promisedAmount" placeholder={kind === "DUES" ? (balance / 100).toString() : ""} />
                </Field>
              </div>
              <Field label="Note" error={state?.errors?.note}>
                <Input name="note" maxLength={500} placeholder="What they said" />
              </Field>
            </>
          )}
        </ActionForm>
      </Card>
      {kind === "DUES" ? (
        <Card title="Record a payment">
          {canCollect ? (
            <ActionForm action={recordPaymentAction.bind(null, id)} submit="Record payment" variant="primary" reset>
              {(state) => (
                <>
                  <p className="m-0 text-[12px] text-muted">Goes through Collect payment: balance check, locked months, receipt numbering and the audit log. The same amount twice within two minutes is refused.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Amount (₹)" error={state?.errors?.amount}>
                      <Input name="amount" defaultValue={(balance / 100).toString()} required />
                    </Field>
                    <Field label="Method" error={state?.errors?.method}>
                      <Select name="method" defaultValue="UPI">
                        {METHODS.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Date" error={state?.errors?.date}>
                      <Input type="date" name="date" defaultValue={today} max={today} required />
                    </Field>
                    <Field label="Reference" error={state?.errors?.txnRef}>
                      <Input name="txnRef" placeholder="UTR / receipt" />
                    </Field>
                  </div>
                </>
              )}
            </ActionForm>
          ) : (
            <p className="text-sm text-muted">Your role can&apos;t collect payments. The front desk can, from the invoice; the case closes by itself once the balance is paid.</p>
          )}
        </Card>
      ) : (
        <Card title="Close the opportunity">
          <p className="mb-3 text-sm text-muted">If the member said no, or moved away. It closes by itself when they buy again.</p>
          <ActionForm action={closeCaseAction.bind(null, id)} submit="Close" variant="danger">
            {(state) => (
              <Field label="Reason" error={state?.errors?.reason}>
                <Input name="reason" required minLength={3} maxLength={200} />
              </Field>
            )}
          </ActionForm>
        </Card>
      )}
      {kind === "DUES" && (
        <Card title="Close without recovery" className="lg:col-span-3">
          <ActionForm action={closeCaseAction.bind(null, id)} submit="Close the case" variant="danger" className="flex flex-wrap items-end gap-3">
            {(state) => (
              <Field label="Reason (written off, disputed, member left…)" className="min-w-[280px] flex-1" error={state?.errors?.reason}>
                <Input name="reason" required minLength={3} maxLength={200} />
              </Field>
            )}
          </ActionForm>
          <p className="mt-2 text-[12px] text-muted">The invoice itself stays as it is: closing a case writes nothing to the books. To cancel the invoice, do it from the invoice with a reason.</p>
        </Card>
      )}
    </div>
  );
}
