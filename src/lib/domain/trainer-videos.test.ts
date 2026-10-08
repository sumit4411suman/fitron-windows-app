import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXERCISES, isExercise, videoEmbed } from "./trainer-videos";

describe("exercise list", () => {
  it("names every exercise and alternative in the app's library, and nothing else", () => {
    const page = readFileSync(new URL("../../../public/trainer/index.html", import.meta.url), "utf8");
    const start = page.indexOf("    const lib = {");
    const lib = page.slice(start, page.indexOf("\n    };", start));
    const inApp = new Set<string>();
    for (const m of lib.matchAll(/name:'([^']+)'/g)) inApp.add(m[1]!);
    for (const m of lib.matchAll(/alts:\[([^\]]*)\]/g)) for (const a of m[1]!.matchAll(/'([^']+)'/g)) inApp.add(a[1]!);
    expect([...inApp].sort()).toEqual([...EXERCISES].sort());
    expect(new Set(EXERCISES).size).toBe(EXERCISES.length);
    expect(isExercise("Bench Press")).toBe(true);
    expect(isExercise("Bench press")).toBe(false);
  });
});

describe("video links", () => {
  it("embeds YouTube in any of its forms, plays direct files, and links the rest", () => {
    const yt = { kind: "youtube", src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&playsinline=1" };
    expect(videoEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s")).toEqual(yt);
    expect(videoEmbed("https://youtu.be/dQw4w9WgXcQ")).toEqual(yt);
    expect(videoEmbed("https://youtube.com/shorts/dQw4w9WgXcQ?feature=share")).toEqual(yt);
    expect(videoEmbed("https://m.youtube.com/embed/dQw4w9WgXcQ")).toEqual(yt);
    expect(videoEmbed(" https://cdn.fitron.in/form/bench.mp4 ")).toEqual({ kind: "video", src: "https://cdn.fitron.in/form/bench.mp4" });
    expect(videoEmbed("https://www.instagram.com/reel/abc123/")).toEqual({ kind: "link", src: "https://www.instagram.com/reel/abc123/" });
    expect(videoEmbed("http://youtu.be/dQw4w9WgXcQ")).toBeNull();
    expect(videoEmbed("javascript:alert(1)")).toBeNull();
    expect(videoEmbed("not a url")).toBeNull();
    expect(videoEmbed("https://youtube.com/watch?v=<script>")).toEqual({ kind: "link", src: "https://youtube.com/watch?v=%3Cscript%3E" });
  });
});
