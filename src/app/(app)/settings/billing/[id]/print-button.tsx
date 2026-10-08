"use client";

import { Button } from "@/components/ui";

export function PrintButton() {
  return (
    <Button variant="primary" type="button" onClick={() => window.print()}>
      Print or save PDF
    </Button>
  );
}
