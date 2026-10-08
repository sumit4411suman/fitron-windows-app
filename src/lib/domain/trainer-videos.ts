// Exercise form videos for the AI Trainer: the exercises the app's library knows (public/trainer/index.html,
// trainer-videos.test.ts keeps the two in step), and how a pasted link is shown in the app.

export const EXERCISES = [
  "Bench Press", "Dumbbell Press", "Push-ups", "Machine Chest Press", "Incline Dumbbell Press", "Incline Machine Press", "Landmine Press", "Cable Fly", "Pec Deck", "Dumbbell Fly",
  "Incline Push-ups", "Knee Push-ups", "Dips", "Bench Dips", "Machine Dip",
  "Deadlift", "Rack Pull", "Trap-bar Deadlift", "Lat Pulldown", "Pull-ups", "Assisted Pull-ups", "Bent-over Row", "Seated Cable Row", "One-arm Dumbbell Row", "Chest-supported Row", "T-bar Row",
  "Face Pulls", "Rear-delt Fly", "Band Pull-apart",
  "Back Squat", "Leg Press", "Goblet Squat", "Romanian Deadlift", "Lying Leg Curl", "Good Morning", "Hack Squat", "Split Squat", "Walking Lunge", "Bulgarian Split Squat", "Step-ups",
  "Calf Raise", "Seated Calf Raise", "Leg-press Calf",
  "Overhead Press", "Machine Shoulder Press", "Arnold Press", "Lateral Raise", "Cable Lateral Raise", "Machine Lateral", "Reverse Pec Deck", "Front Raise", "Cable Front Raise", "Plate Raise",
  "Upright Row", "Cable Upright Row", "Dumbbell Upright Row",
  "Barbell Curl", "EZ-bar Curl", "Dumbbell Curl", "Close-grip Bench Press", "Hammer Curl", "Rope Hammer Curl", "Incline Curl", "Triceps Pushdown", "Overhead Extension", "Kickbacks",
  "Overhead Triceps Extension", "Skull Crushers", "Rope Kickbacks",
  "Plank", "Side Plank", "Dead Bug", "Hanging Leg Raise", "Lying Leg Raise", "Reverse Crunch", "Cable Crunch", "Crunches", "Machine Crunch", "Russian Twist", "Cable Woodchop", "Bicycle Crunch",
  "Bird Dog", "Hollow Hold",
  "Cable Row", "Dumbbell Row", "Machine Press",
] as const;

export const isExercise = (name: string): name is (typeof EXERCISES)[number] => (EXERCISES as readonly string[]).includes(name);

export type VideoEmbed = { kind: "youtube" | "video" | "link"; src: string };

/**
 * How the app plays a link: YouTube (watch, youtu.be, shorts, embed) in an iframe, a direct .mp4/.webm
 * in a video element, anything else https as a link that opens in the browser. Not https → null.
 */
export function videoEmbed(raw: string): VideoEmbed | null {
  const url = raw.trim();
  if (url.length > 500) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.replace(/^www\.|^m\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else {
      const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/);
      id = m?.[1] ?? null;
    }
  }
  if (id && /^[\w-]{6,20}$/.test(id)) return { kind: "youtube", src: `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1` };
  if (/\.(mp4|webm|m4v|mov)$/i.test(u.pathname)) return { kind: "video", src: u.toString() };
  return { kind: "link", src: u.toString() };
}
