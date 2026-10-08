"use client";

import { ErrorScreen } from "@/components/error-screen";

// A page of the public website failed. (The console has its own, inside its sidebar: src/app/(app)/error.tsx.)
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorScreen error={error} retry={retry} where="page" home={{ href: "/", label: "Back to fitron.in" }} />;
}
