"use client";

import { ErrorScreen } from "@/components/error-screen";

// A console page failed. This sits inside the console's layout, so the sidebar stays and only the page is replaced.
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorScreen error={error} retry={retry} where="app" home={{ href: "/dashboard", label: "Go to the dashboard" }} />;
}
