import { Logo } from "@/components/logo";
import "./(site)/site.css";

// An address that doesn't exist on fitron.in (and what notFound() shows outside the console).
export default function NotFound() {
  return (
    <div className="site-ui mx-auto flex min-h-screen max-w-2xl flex-col items-start justify-center gap-5 px-4 py-16">
      <a href="/" aria-label="FITRON home">
        <Logo size={36} />
      </a>
      <p className="s-eyebrow">Error 404</p>
      <h1 className="text-4xl sm:text-5xl">Looks like you took a wrong turn.</h1>
      <p className="text-lg text-muted">The page you&apos;re looking for doesn&apos;t exist or may have moved.</p>
      <div className="flex flex-wrap gap-3">
        <a href="/" className="s-btn s-btn-primary">
          Back to FITRON
        </a>
        <a href="/ai-personal-trainer" className="s-btn s-btn-ghost">
          Explore AI Trainer
        </a>
        <a href="/gym-accounting" className="s-btn s-btn-ghost">
          Explore Gym Accounting
        </a>
        <a href="/contact" className="s-btn s-btn-ghost">
          Contact us
        </a>
      </div>
    </div>
  );
}
