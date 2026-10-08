import "server-only";
import { db } from "@/lib/db";
import { EXERCISES, isExercise, videoEmbed, type VideoEmbed } from "@/lib/domain/trainer-videos";
import { UserError } from "./errors";

// Exercise form videos: one link per exercise, set by the FITRON team, shown in the AI Trainer
// in place of the demo's drop-in placeholder.

/** Every exercise, with its video when one is set, for the admin page. */
export async function listContent() {
  const rows = await db.trainerContent.findMany();
  const by = new Map(rows.map((r) => [r.ex, r]));
  return EXERCISES.map((ex) => {
    const r = by.get(ex);
    return { ex, videoUrl: r?.videoUrl ?? "", note: r?.note ?? "", embed: r ? videoEmbed(r.videoUrl) : null, updatedBy: r?.updatedBy ?? null, updatedAt: r?.updatedAt ?? null };
  });
}

/** Sets (or, with an empty link, clears) an exercise's video. */
export async function saveContent(by: { email: string }, ex: string, videoUrl: string, note = "") {
  if (!isExercise(ex)) throw new UserError("That exercise isn't in the app's library.");
  const url = videoUrl.trim();
  if (!url) {
    await db.trainerContent.deleteMany({ where: { ex } });
    return null;
  }
  if (!videoEmbed(url)) throw new UserError("Paste an https link: a YouTube video or Short, or a direct .mp4 file.");
  const data = { videoUrl: url, note: note.trim().slice(0, 200) || null, updatedBy: by.email };
  return db.trainerContent.upsert({ where: { ex }, create: { ex, ...data }, update: data });
}

/** What the app loads: exercise → how to play its video, and the note under it. */
export async function publicContent(): Promise<Record<string, VideoEmbed & { note: string }>> {
  const rows = await db.trainerContent.findMany({ select: { ex: true, videoUrl: true, note: true } });
  const out: Record<string, VideoEmbed & { note: string }> = {};
  for (const r of rows) {
    const e = videoEmbed(r.videoUrl);
    if (e) out[r.ex] = { ...e, note: r.note ?? "" };
  }
  return out;
}
