"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UploadSimpleIcon, XIcon } from "@phosphor-icons/react";
import { changeLogo } from "./actions";
import { Button, Notice } from "@/components/ui";
import { DEFAULT_LOGO } from "@/components/gym-logo";

const MAX_BYTES = 1024 * 1024;
const CANVAS_W = 600;
const CANVAS_H = 210;

type Crop = { src: string; file: File; zoom: number; x: number; y: number };

/**
 * The prototype's logo row: the current logo, "Change logo" (which opens the Crop logo dialog and
 * saves a 600×210 PNG), "Use default" when a custom logo is set, and the size/format helper.
 */
export function LogoForm({ logoSrc, hasLogo }: { logoSrc: string | null; hasLogo: boolean }) {
  const router = useRouter();
  // "Use default" is a plain form; the upload calls the action itself so the dialog can react to the answer.
  const [removeState, removeAction, removing] = useActionState(changeLogo, undefined);
  const [uploadState, setUploadState] = useState<{ ok?: boolean; message: string } | null>(null);
  const [uploading, startUpload] = useTransition();
  const [crop, setCrop] = useState<Crop | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const pending = removing || uploading;

  const pick = (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setLocalError("Logo must be under 1 MB.");
      return;
    }
    setLocalError(null);
    setUploadState(null);
    const r = new FileReader();
    r.onload = () => setCrop({ src: String(r.result), file, zoom: 100, x: 50, y: 50 });
    r.readAsDataURL(file);
  };

  const submit = (file: File) => {
    const fd = new FormData();
    fd.set("logo", file, file.name || "logo.png");
    startUpload(async () => {
      const r = await changeLogo(undefined, fd);
      setUploadState(r?.message ? { ok: r.ok, message: r.message } : null);
      if (r?.ok) {
        setCrop(null);
        router.refresh();
      }
    });
  };

  /** Draws the picked image onto a 600×210 canvas exactly as the prototype, and uploads the PNG. */
  const saveCrop = () => {
    if (!crop) return;
    const img = new Image();
    img.onload = () => {
      try {
        const cv = document.createElement("canvas");
        cv.width = CANVAS_W;
        cv.height = CANVAS_H;
        const ctx = cv.getContext("2d");
        if (!ctx) throw new Error("no canvas");
        const z = crop.zoom / 100;
        const fit = Math.min(CANVAS_W / img.width, CANVAS_H / img.height) * z;
        const w = img.width * fit;
        const h = img.height * fit;
        const dx = (CANVAS_W - w) / 2 + ((CANVAS_W * (crop.x - 50)) / 100) * z;
        const dy = (CANVAS_H - h) / 2 + ((CANVAS_H * (crop.y - 50)) / 100) * z;
        ctx.drawImage(img, dx, dy, w, h);
        cv.toBlob((blob) => {
          if (blob) submit(new File([blob], "logo.png", { type: "image/png" }));
          else submit(crop.file);
        }, "image/png");
      } catch {
        // A tainted or unsupported canvas: send the original file instead.
        submit(crop.file);
      }
    };
    img.onerror = () => submit(crop.file);
    img.src = crop.src;
  };

  const state = uploadState ?? (removeState?.message ? { ok: removeState.ok, message: removeState.message } : null);
  const message = localError ?? (!crop && state ? state.message : null);
  const tone = localError || (state && !state.ok) ? "alert" : "ok";
  const tx = ((crop?.x ?? 50) - 50) * ((crop?.zoom ?? 100) / 100);
  const ty = ((crop?.y ?? 50) - 50) * ((crop?.zoom ?? 100) / 100);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- private, session-checked image */}
        <img src={logoSrc ?? DEFAULT_LOGO} alt="Gym logo" width={160} height={56} className="h-14 w-40 rounded-lg border border-line bg-surface object-cover" />
        <label className="inline-flex py-2.5 leading-[1.2] cursor-pointer items-center gap-1.5 rounded-md border border-line px-[18px] text-sm font-semibold whitespace-nowrap hover:bg-fg/7">
          <UploadSimpleIcon size={16} weight="duotone" />
          Change logo
          <input type="file" name="logo" accept="image/png,image/jpeg,image/svg+xml" className="sr-only" disabled={pending} onChange={(e) => pick(e.currentTarget)} />
        </label>
        {hasLogo && (
          <form action={removeAction} onSubmit={() => { setUploadState(null); setLocalError(null); }}>
            <Button variant="ghost" name="intent" value="remove" disabled={pending}>
              Use default
            </Button>
          </form>
        )}
        <span className="text-[13px] text-muted">PNG, JPG or SVG up to 1 MB. Shown in the sidebar and on invoices.</span>
      </div>
      {message && <Notice tone={tone}>{message}</Notice>}
      {crop && (
        <div className="fixed inset-0 z-50 grid place-items-center p-5 max-lg:items-end max-lg:p-0">
          <button type="button" aria-label="Close" onClick={() => setCrop(null)} className="absolute inset-0 bg-[color-mix(in_srgb,var(--text)_8%,rgba(0,0,0,0.6))]" />
          <div role="dialog" aria-modal="true" aria-label="Crop logo" className="relative flex w-[min(520px,100%)] flex-col gap-3.5 rounded-lg bg-bg p-5 shadow-lg max-lg:rounded-t-[18px] max-lg:rounded-b-none">
            <div className="flex justify-between gap-3">
              <div>
                <div className="text-[11px] tracking-[0.1em] text-muted uppercase">Gym logo</div>
                <div className="text-xl font-semibold">Crop logo</div>
              </div>
              <button type="button" onClick={() => setCrop(null)} className="grid size-9 place-items-center rounded-md hover:bg-fg/7" aria-label="Close">
                <XIcon size={18} />
              </button>
            </div>
            {uploadState && !uploadState.ok && <Notice tone="alert">{uploadState.message}</Notice>}
            <div className="relative aspect-[20/7] w-full overflow-hidden rounded-lg bg-surface">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the picked file */}
              <img src={crop.src} alt="" className="absolute top-0 left-0 size-full object-contain" style={{ transform: `translate(${tx}%, ${ty}%) scale(${crop.zoom / 100})` }} />
            </div>
            <label className="flex flex-col gap-[5px] text-sm">
              <span className="text-xs text-fg/70">Zoom</span>
              <input type="range" min={100} max={300} value={crop.zoom} onChange={(e) => setCrop({ ...crop, zoom: Number(e.target.value) })} className="w-full accent-accent" aria-label="Zoom" />
            </label>
            <div className="grid grid-cols-2 gap-3.5">
              <label className="flex flex-col gap-[5px] text-sm">
                <span className="text-xs text-fg/70">Left / right</span>
                <input type="range" min={0} max={100} value={crop.x} onChange={(e) => setCrop({ ...crop, x: Number(e.target.value) })} className="w-full accent-accent" aria-label="Left / right" />
              </label>
              <label className="flex flex-col gap-[5px] text-sm">
                <span className="text-xs text-fg/70">Up / down</span>
                <input type="range" min={0} max={100} value={crop.y} onChange={(e) => setCrop({ ...crop, y: Number(e.target.value) })} className="w-full accent-accent" aria-label="Up / down" />
              </label>
            </div>
            <div className="flex justify-end gap-2.5">
              <Button type="button" variant="ghost" onClick={() => setCrop(null)} disabled={pending}>
                Cancel
              </Button>
              <Button type="button" variant="primary" onClick={saveCrop} disabled={pending}>
                {pending ? "Saving…" : "Save logo"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
