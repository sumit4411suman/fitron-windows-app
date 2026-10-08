import type { Tone } from "@/components/ui";

export const ASSET_STATUS: Record<string, string> = { IN_USE: "In use", SOLD: "Sold", SCRAPPED: "Scrapped" };
export const ASSET_TONE: Record<string, Tone> = { IN_USE: "ok", SOLD: "neutral", SCRAPPED: "alert" };
