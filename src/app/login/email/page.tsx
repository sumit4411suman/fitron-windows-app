import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current";
import { safeNext } from "@/lib/auth/next";
import { ConfirmLinkForm } from "./confirm-form";

export const metadata = { title: "Confirm sign-in · FITRON", robots: { index: false } };

/**
 * The link in a sign-in email lands here. Opening it changes nothing: mail scanners and link previews open links, and
 * must not use it up. The button posts the token (confirmSignInLink in ../actions.ts), and that signs in.
 */
export default async function EmailSignInPage({ searchParams }: PageProps<"/login/email">) {
  const q = await searchParams;
  const next = safeNext(q.next, "");
  if (await getCurrentUser()) redirect(next || "/dashboard");
  const token = typeof q.token === "string" ? q.token : "";
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6 py-10">
      <h1 className="text-[28px] font-semibold">Sign in to Fitron</h1>
      {token ? (
        <>
          <p className="m-0 text-sm text-neutral-700">Press the button to finish signing in on this device. If you didn&apos;t ask for this email, close this page.</p>
          <ConfirmLinkForm token={token} next={next} />
        </>
      ) : (
        <p className="m-0 text-sm text-neutral-700">This page needs the link from your email.</p>
      )}
      <Link href="/login?mode=email" className="self-start py-1 text-[13px] text-accent no-underline">Ask for a new code or link</Link>
    </main>
  );
}
