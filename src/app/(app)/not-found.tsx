import { LinkButton } from "@/components/ui";

// notFound() inside the console: a member, invoice or page that isn't there (or isn't this gym's). Keeps the sidebar.
export default function NotFound() {
  return (
    <div className="flex max-w-xl flex-col items-start gap-4 py-16">
      <p className="text-xs font-semibold tracking-[0.2em] text-accent uppercase">Not found</p>
      <h1 className="text-3xl font-semibold">We couldn&apos;t find that</h1>
      <p className="text-lg text-muted">It may have been removed, or it belongs to a different branch or gym.</p>
      <LinkButton href="/dashboard" variant="primary">
        Go to the dashboard
      </LinkButton>
    </div>
  );
}
