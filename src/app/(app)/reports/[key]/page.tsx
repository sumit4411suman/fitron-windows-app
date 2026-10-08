import { redirect } from "next/navigation";

/** Old per-report links open the same report in the report centre. */
export default async function ReportPage({ params, searchParams }: PageProps<"/reports/[key]">) {
  const { key } = await params;
  const sp = await searchParams;
  const q = new URLSearchParams({ r: key });
  for (const k of ["from", "to"]) if (typeof sp[k] === "string") q.set(k, sp[k] as string);
  redirect(`/reports?${q}`);
}
