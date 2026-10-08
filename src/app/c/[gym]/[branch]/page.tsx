import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Logo } from "@/components/logo";
import { checkInPoint } from "@/lib/services/self-checkin";
import { CheckInForm } from "./check-in-form";

// What the front-desk QR poster opens (Attendance › QR): https://<site>/c/<gym>/<branch id>. The gym part of the address is
// only for people to read; the branch id says where the visit is recorded.
export const metadata = { title: "Check in · FITRON", robots: { index: false, follow: false } };

export default async function CheckInPage({ params }: PageProps<"/c/[gym]/[branch]">) {
  // Whether a branch can take check-ins changes with its gym's plan, so this is never prepared ahead of the request.
  await connection();
  const { branch } = await params;
  const point = await checkInPoint(branch);
  if (!point) notFound();
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-8 px-4 py-10">
      <a href="/" aria-label="FITRON home" className="self-center">
        <Logo size={32} />
      </a>
      <div className="text-center">
        <p className="text-xs font-semibold tracking-[0.2em] text-accent uppercase">Check in</p>
        <h1 className="mt-2 text-3xl font-semibold">{point.gymName}</h1>
        <p className="mt-1 text-muted">{point.branchName}</p>
      </div>
      {point.open ? <CheckInForm branchId={point.branchId} /> : <p className="text-center text-muted">Check-in from this page isn&apos;t switched on. Please ask at the front desk.</p>}
    </main>
  );
}
