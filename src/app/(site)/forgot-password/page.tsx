import { ForgotForm } from "./forgot-form";

export const metadata = { title: "Forgot password · FITRON" };

export default function ForgotPasswordPage() {
  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-4xl font-semibold">Forgot password?</h1>
      <p className="mt-4 mb-8 text-lg text-muted">Enter your email and we&apos;ll send you a six-digit code and a link to choose a new one.</p>
      <ForgotForm />
      <p className="mt-8 text-sm text-muted">
        Remembered it? <a href="/login" className="text-accent underline">Sign in</a>
      </p>
    </div>
  );
}
