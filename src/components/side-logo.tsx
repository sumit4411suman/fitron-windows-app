"use client";

import Image from "next/image";

/**
 * The sidebar logo from the prototype: the gym's own logo when one is uploaded in Settings, else
 * the gold ring with a light wordmark on dark, and mark and text on light.
 */
export function SideLogo({ src, name }: { src?: string | null; name?: string } = {}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- private, session-checked image
      <img src={src} alt={name ?? "Gym logo"} className="block h-auto max-h-[70px] w-full object-contain object-left" />
    );
  }
  return (
    <>
      <Image src="/fitron-logo.png" alt="FITRON" width={599} height={218} className="block h-auto w-full light:hidden" />
      <span className="hidden items-center gap-2.5 py-2 light:inline-flex">
        <Image src="/fitron-mark.png" alt="" width={40} height={40} />
        <span className="text-2xl font-bold tracking-[0.18em]">FITRON</span>
      </span>
    </>
  );
}
