import { describe, expect, it } from "vitest";
import { hasDb } from "@/test/db";
import { EXERCISES } from "@/lib/domain/trainer-videos";
import { listContent, publicContent, saveContent } from "./trainer-content";

describe.skipIf(!hasDb)("exercise form videos (database)", () => {
  it("keeps one link per exercise, validated, and serves them to the app", async () => {
    const by = { email: "team@fitron.in" };
    await saveContent(by, "Bench Press", " https://youtu.be/dQw4w9WgXcQ ", "Bar over mid-foot");
    await saveContent(by, "Bench Press", "https://youtube.com/shorts/abcdefgh123");
    await expect(saveContent(by, "Bench Press", "http://youtu.be/dQw4w9WgXcQ")).rejects.toThrow(/https link/);
    await expect(saveContent(by, "Not an exercise", "https://youtu.be/dQw4w9WgXcQ")).rejects.toThrow(/library/);

    const all = await listContent();
    expect(all).toHaveLength(EXERCISES.length);
    const bench = all.find((r) => r.ex === "Bench Press")!;
    expect(bench.videoUrl).toBe("https://youtube.com/shorts/abcdefgh123");
    expect(bench.note).toBe("");
    expect(bench.embed?.kind).toBe("youtube");
    expect(bench.updatedBy).toBe("team@fitron.in");
    expect((await publicContent())["Bench Press"]?.src).toContain("/embed/abcdefgh123");

    await saveContent(by, "Bench Press", "");
    expect((await listContent()).find((r) => r.ex === "Bench Press")?.videoUrl).toBe("");
    expect((await publicContent())["Bench Press"]).toBeUndefined();
  });
});
