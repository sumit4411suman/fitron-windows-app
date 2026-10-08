import { cx } from "./ui";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/** The URL changes with the photo, so browsers never show a stale one. */
export const photoUrl = (userId: string, photoKey: string | null) =>
  photoKey ? `/profile/photo/${userId}?v=${encodeURIComponent(photoKey.split("/").pop() ?? "")}` : null;

export const memberPhotoUrl = (memberId: string, photoKey: string | null) =>
  photoKey ? `/members/${memberId}/photo?v=${encodeURIComponent(photoKey.split("/").pop() ?? "")}` : null;

export function Avatar({ name, src, className }: { name: string; src: string | null; className?: string }) {
  return (
    <span className={cx("relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-accent font-semibold text-accent-ink", className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- private, session-checked image
        <img src={src} alt="" className="absolute inset-0 size-full bg-surface object-cover" />
      ) : (
        initials(name) || "?"
      )}
    </span>
  );
}
