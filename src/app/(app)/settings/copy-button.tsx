"use client";

import { useState } from "react";
import { CopyIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui";

export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          // Clipboard blocked: nothing to do.
        }
      }}
    >
      <CopyIcon size={16} /> {done ? "Copied" : "Copy"}
    </Button>
  );
}
