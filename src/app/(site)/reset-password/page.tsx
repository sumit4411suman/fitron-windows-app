import { ResetForm } from "./reset-form";

export const metadata = { title: "Choose a new password · FITRON" };

export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const q = await searchParams;
  const token = typeof q.token === "string" ? q.token : "";
  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-4xl font-semibold">Choose a new password</h1>
      {token ? (
        <>
          <p className="mt-4 mb-8 text-lg text-muted">This signs you out on every other device.</p>
          <ResetForm token={token} />
        </>
      ) : (
        <p className="mt-4 text-lg text-muted">
          This page needs the link from your email. <a href="/forgot-password" className="text-accent underline">Ask for a new link</a>
        </p>
      )}
    </div>
  );
}
