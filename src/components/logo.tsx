import Image from "next/image";

/** The round mark: gold on a dark disc in the dark theme, gold on transparent in the light theme. */
export function BrandMark({ size, className = "", priority = false }: { size: number; className?: string; priority?: boolean }) {
  return (
    <>
      <Image src="/fitron-mark-v2.png" alt="" width={size} height={size} priority={priority} className={`light:hidden ${className}`} />
      <Image src="/fitron-mark-light-v2.png" alt="" width={size} height={size} priority={priority} className={`hidden light:inline ${className}`} />
    </>
  );
}

/** Mark + wordmark in text, so it reads on both light and dark backgrounds. `priority` fetches the mark early: for the one at the top of the page, not a footer's. */
export function Logo({ size = 36, priority = true }: { size?: number; priority?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <BrandMark size={size} priority={priority} />
      <span className="text-xl font-bold tracking-[0.18em]" style={{ fontSize: size * 0.6 }}>
        FITRON
      </span>
    </span>
  );
}
