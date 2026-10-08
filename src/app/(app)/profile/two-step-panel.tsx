"use client";

import { useActionState, useState } from "react";
import { cancelTwoStepSetup, confirmTwoStepSetup, newRecoveryCodes, startTwoStepSetup, turnOffTwoStep, type TwoStepState } from "./actions";
import { Button, Field, Input, Notice } from "@/components/ui";

type Status = { enabled: boolean; enabledOn: string | null; recoveryLeft: number };
type Setup = { grouped: string; qr: string } | null;

/** The ten recovery codes, shown once, with a way to keep them. */
function Codes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const text = `FITRON recovery codes\nEach works once, if you cannot use your authenticator app.\n\n${codes.join("\n")}\n`;
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "fitron-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-accent/50 bg-accent-soft p-4" role="region" aria-label="Recovery codes">
      <h3 className="text-[17px] font-semibold">Save your recovery codes</h3>
      <p className="text-sm text-muted">
        If you lose your phone, each of these signs you in once, in place of the app&apos;s code. <b>They are shown only now.</b> Keep them somewhere safe that is not your phone: printed, or in a password manager.
      </p>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-[15px] tracking-wider sm:max-w-sm">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => void navigator.clipboard?.writeText(text)}>
          Copy
        </Button>
        <Button type="button" onClick={download}>
          Download
        </Button>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I have saved these codes
      </label>
      <div>
        <Button type="button" variant="primary" disabled={!saved} onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

export function TwoStepPanel({ status, setup }: { status: Status; setup: Setup }) {
  const [started, startAction, starting] = useActionState(startTwoStepSetup, undefined);
  const [cancelled, cancelAction, cancelling] = useActionState(cancelTwoStepSetup, undefined);
  const [confirmed, confirmAction, confirming] = useActionState<TwoStepState, FormData>(confirmTwoStepSetup, undefined);
  const [renewed, renewAction, renewing] = useActionState<TwoStepState, FormData>(newRecoveryCodes, undefined);
  const [off, offAction, turningOff] = useActionState<TwoStepState, FormData>(turnOffTwoStep, undefined);
  const [hiddenFor, setHiddenFor] = useState<string[]>([]);
  // Codes made by confirming the setup, or by asking for new ones: shown until the person says they are saved.
  const fresh = [confirmed, renewed].find((s) => s?.codes && !hiddenFor.includes(s.nonce ?? ""));
  const message = [started, cancelled].find((s) => s?.message && !s.ok);

  if (fresh?.codes) return <Codes codes={fresh.codes} onDone={() => setHiddenFor((h) => [...h, fresh.nonce ?? ""])} />;

  if (status.enabled) {
    const low = status.recoveryLeft <= 2;
    return (
      <div className="flex max-w-xl flex-col gap-6">
        <div>
          <h2 className="text-[17px] font-semibold">Two-step sign-in is on</h2>
          <p className="mt-1 text-sm text-muted">
            Since {status.enabledOn}. After your password (or Google), FITRON asks for the code from your authenticator app.
          </p>
        </div>
        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <h3 className="font-semibold">Recovery codes</h3>
          {low && <Notice tone="alert">{status.recoveryLeft === 0 ? "You have no recovery codes left." : `You have ${status.recoveryLeft} recovery code${status.recoveryLeft === 1 ? "" : "s"} left.`} Make new ones below.</Notice>}
          {!low && <p className="text-sm text-muted">{status.recoveryLeft} unused. Each works once, if you cannot use your app.</p>}
          <form action={renewAction} key={renewed?.nonce} className="flex flex-col gap-3">
            {renewed?.message && !renewed.ok && <Notice tone="alert">{renewed.message}</Notice>}
            <Field label="Your password" error={renewed?.errors?.password}>
              <Input name="password" type="password" autoComplete="current-password" required />
            </Field>
            <div>
              <Button disabled={renewing}>{renewing ? "Making…" : "Make new recovery codes"}</Button>
            </div>
          </form>
          <p className="text-xs text-muted">Making new codes stops the old ones working.</p>
        </div>
        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <h3 className="font-semibold">Turn off</h3>
          <form action={offAction} key={off?.nonce} className="flex flex-col gap-3">
            {off?.message && <Notice tone={off.ok ? "ok" : "alert"}>{off.message}</Notice>}
            <Field label="Your password" error={off?.errors?.password}>
              <Input name="password" type="password" autoComplete="current-password" required />
            </Field>
            <Field label="A code from your app, or a recovery code" error={off?.errors?.code}>
              <Input name="code" autoComplete="one-time-code" spellCheck={false} required maxLength={20} />
            </Field>
            <div>
              <Button variant="danger" disabled={turningOff}>
                {turningOff ? "Turning off…" : "Turn off two-step sign-in"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  if (setup) {
    return (
      <div className="flex max-w-xl flex-col gap-5">
        <h2 className="text-[17px] font-semibold">Set up two-step sign-in</h2>
        <ol className="flex list-decimal flex-col gap-4 pl-5 text-sm">
          <li>Install an authenticator app on your phone, such as Google Authenticator, Microsoft Authenticator, Authy or 1Password.</li>
          <li>
            In the app, add an account and scan this code:
            <div className="mt-2 w-44 rounded-md bg-white p-2" role="img" aria-label="QR code for your authenticator app" dangerouslySetInnerHTML={{ __html: setup.qr }} />
            <p className="mt-2 text-muted">
              Cannot scan it? Choose &ldquo;enter a setup key&rdquo; and type <code className="rounded border border-line bg-surface-2 px-1.5 py-0.5 text-fg">{setup.grouped}</code>
            </p>
          </li>
          <li>Type the 6-digit code the app now shows, to check that it works.</li>
        </ol>
        <form action={confirmAction} key={confirmed?.nonce} className="flex max-w-xs flex-col gap-3">
          {confirmed?.message && !confirmed.ok && <Notice tone="alert">{confirmed.message}</Notice>}
          <Field label="Code from the app" error={confirmed?.errors?.code}>
            <Input name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={10} placeholder="123456" className="tracking-widest" />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={confirming}>
              {confirming ? "Checking…" : "Turn on"}
            </Button>
          </div>
        </form>
        <form action={cancelAction}>
          <Button variant="ghost" disabled={cancelling}>
            Cancel setup
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <h2 className="text-[17px] font-semibold">Two-step sign-in is off</h2>
      <p className="text-sm text-muted">
        Adds a second check to your sign-in: after your password (or Google), FITRON asks for a 6-digit code from an app on your phone. Someone who learns your password still cannot open your account. Recommended for everyone who can see money or members, and for the Super Admin above all.
      </p>
      {message?.message && <Notice tone="alert">{message.message}</Notice>}
      <form action={startAction}>
        <Button variant="primary" disabled={starting}>
          {starting ? "Starting…" : "Set up two-step sign-in"}
        </Button>
      </form>
    </div>
  );
}
