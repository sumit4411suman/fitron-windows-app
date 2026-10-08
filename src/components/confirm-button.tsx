"use client";

import type { ComponentProps } from "react";
import { Button } from "./ui";

/** A submit button that asks before submitting its form. */
export function ConfirmButton({ confirm, ...p }: ComponentProps<typeof Button> & { confirm: string }) {
  return (
    <Button
      {...p}
      onClick={(e) => {
        if (!window.confirm(confirm)) e.preventDefault();
      }}
    />
  );
}
