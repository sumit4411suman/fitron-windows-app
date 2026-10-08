import Image from "next/image";

/** Mark + wordmark in text, so it reads on both light and dark backgrounds. `priority` fetches the mark early: for the one at the top of the page, not a footer's. */
export function Logo({ size = 36, priority = true }: { size?: number; priority?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Image src="/fitron-mark.png" alt="" width={size} height={size} priority={priority} />
      <span className="text-xl font-bold tracking-[0.18em]" style={{ fontSize: size * 0.6 }}>
        FITRON
      </span>
    </span>
  );
}
