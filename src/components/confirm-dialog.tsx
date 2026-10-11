"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./ui";

/**
 * The app's own modal for questions asked in the browser (the server-driven Dialog in dialog.tsx opens from a URL).
 * Drawn over the whole page from document.body, so a button deep in a scrolling table still opens it in full view.
 * Escape or a click on the dimmed page closes it.
 */
export function Modal({ title, onClose, children, role = "dialog" }: { title: string; onClose: () => void; children: ReactNode; role?: "dialog" | "alertdialog" }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    // Focus the first field, else the main button, so the keyboard lands inside the modal.
    box.current?.querySelector<HTMLElement>("input, textarea, select, [data-autofocus]")?.focus();
    return () => {
      document.removeEventListener("keydown", key);
      before?.focus?.();
    };
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center overflow-auto p-5 max-lg:items-end max-lg:p-0">
      <div aria-hidden className="absolute inset-0 bg-[color-mix(in_srgb,var(--text)_8%,rgba(0,0,0,0.6))]" onClick={onClose} />
      <div
        ref={box}
        role={role}
        aria-modal="true"
        aria-label={title}
        className="relative flex max-h-[92vh] w-[min(440px,100%)] flex-col gap-3.5 overflow-auto rounded-lg bg-surface p-5 text-left whitespace-normal shadow-lg max-lg:rounded-t-[18px] max-lg:rounded-b-none"
      >
        <div className="text-xl font-semibold">{title}</div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

type Ask = { title: string; message?: string; label: string; danger?: boolean; resolve: (ok: boolean) => void };

/**
 * An in-app replacement for window.confirm: `const [confirm, dialog] = useConfirm()`, render `dialog`, then
 * `if (await confirm({ title, message, label })) …`.
 */
export function useConfirm() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const confirm = useCallback((o: Omit<Ask, "resolve">) => new Promise<boolean>((resolve) => setAsk({ ...o, resolve })), []);
  const answer = useCallback(
    (ok: boolean) =>
      setAsk((a) => {
        a?.resolve(ok);
        return null;
      }),
    [],
  );
  const no = useCallback(() => answer(false), [answer]);
  const dialog = ask && (
    <Modal title={ask.title} onClose={no} role="alertdialog">
      {ask.message && <p className="m-0 text-sm text-muted">{ask.message}</p>}
      <div className="flex justify-end gap-2.5">
        <Button type="button" onClick={no}>
          Cancel
        </Button>
        <Button type="button" variant={ask.danger ? "danger" : "primary"} data-autofocus onClick={() => answer(true)}>
          {ask.label}
        </Button>
      </div>
    </Modal>
  );
  return [confirm, dialog] as const;
}

/**
 * For a form that must be confirmed before it is sent: `const [onSubmit, dialog] = useConfirmSubmit(() => question)`,
 * then `<form onSubmit={onSubmit}>` and render `dialog`. Returning null from `question` sends without asking.
 */
export function useConfirmSubmit(question: () => Omit<Ask, "resolve"> | null) {
  const [ask, dialog] = useConfirm();
  const sure = useRef(false);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    const q = question();
    if (!q || sure.current) {
      sure.current = false;
      return;
    }
    e.preventDefault();
    const form = e.currentTarget;
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    void ask(q).then((ok) => {
      if (!ok) return;
      sure.current = true;
      form.requestSubmit(submitter ?? undefined);
    });
  };
  return [onSubmit, dialog] as const;
}
