"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { FormState } from "@/lib/validation/common";
import { Button, Notice } from "@/components/ui";

/** Longest side of the photo we send. Avatars are shown far smaller than this. */
const MAX_SIDE = 1024;
/** Hosts such as Vercel turn away requests over about 4.5 MB before they reach the app. */
const MAX_SEND_BYTES = 4 * 1024 * 1024;

/**
 * A phone camera photo made small enough to send: at most 1024 px on its longest side, as JPEG.
 * Falls back to the original file when the browser can't read the image.
 */
async function shrink(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85));
    if (blob && blob.size < file.size) return new File([blob], "photo.jpg", { type: "image/jpeg" });
  } catch {
    // Not an image this browser can draw: send it as it is and let the server answer.
  }
  return file;
}

/**
 * "Upload photo" / "Change photo" and "Remove", for a staff or member photo. The picked photo is
 * shrunk in the browser first, and a failed upload is shown as a message instead of breaking the page.
 */
export function PhotoUpload({ hasPhoto, action }: { hasPhoto: boolean; action: (prev: FormState, fd: FormData) => Promise<FormState> }) {
  const router = useRouter();
  const [state, setState] = useState<FormState>(undefined);
  const [pending, start] = useTransition();

  const send = (fd: FormData) =>
    start(async () => {
      let r: FormState;
      try {
        r = await action(undefined, fd);
      } catch {
        // The action itself failed to run (the request never got through, or the server crashed): the only case
        // where "check your connection" is the honest advice. A rule the server could explain comes back as `r`.
        setState({ message: "The photo couldn't be saved. Check your connection and try again, or pick a smaller photo." });
        return;
      }
      // The server's own words (storage not set up, wrong file type, too large…) are shown as they are.
      setState(r?.ok || r?.message ? r : { message: "The photo couldn't be saved. Try again, or pick a smaller photo." });
      if (r?.ok) router.refresh();
    });

  const pick = async (input: HTMLInputElement) => {
    const picked = input.files?.[0];
    input.value = "";
    if (!picked) return;
    const file = await shrink(picked);
    if (file.size > MAX_SEND_BYTES) {
      setState({ message: "That photo is too large. Pick a smaller one." });
      return;
    }
    const fd = new FormData();
    fd.set("photo", file, file.name);
    send(fd);
  };

  const remove = () => {
    const fd = new FormData();
    fd.set("intent", "remove");
    send(fd);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-line bg-surface px-4 text-sm font-semibold hover:bg-surface-2">
          {pending ? "Saving…" : hasPhoto ? "Change photo" : "Upload photo"}
          <input type="file" name="photo" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={pending} onChange={(e) => void pick(e.currentTarget)} />
        </label>
        {hasPhoto && (
          <Button type="button" variant="ghost" disabled={pending} onClick={remove}>
            Remove
          </Button>
        )}
        <span className="text-xs text-muted">JPG, PNG or WebP</span>
      </div>
      {state?.message && <Notice tone={state.ok ? "ok" : "alert"}>{state.message}</Notice>}
    </div>
  );
}
