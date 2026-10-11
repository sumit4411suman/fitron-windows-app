"use client";

import type { ComponentProps } from "react";
import { useConfirm } from "./confirm-dialog";
import { Button } from "./ui";

/** A submit button that asks, in the app's own modal, before submitting its form. */
export function ConfirmButton({ confirm, ...p }: ComponentProps<typeof Button> & { confirm: string }) {
  const [ask, dialog] = useConfirm();
  return (
    <>
      <Button
        {...p}
        onClick={async (e) => {
          // Submitting by hand after the answer keeps the button's own name and value in the form data.
          e.preventDefault();
          const button = e.currentTarget;
          if (await ask({ title: confirm, label: typeof p.children === "string" ? p.children : "Confirm", danger: /alert/.test(p.className ?? "") || p.variant === "danger" })) button.form?.requestSubmit(button);
        }}
      />
      {dialog}
    </>
  );
}
