import "@/lib/zod-config";
import { z } from "zod";
import data from "./about-data.json";

// The facts about the people behind FITRON that only the owner can supply, kept in one file (about-data.json) so a page never
// carries a made-up one. Each list is empty until it is filled in, and the site shows a section only when its list has an
// entry: there is no placeholder text anywhere. Fill them in with real things only:
//
//  - founders: a real person who runs FITRON, with the role and the few lines they would write about themselves.
//  - social:   an official FITRON account that exists (shown in the footer and as `sameAs` in the structured data).
//  - stories:  something a real customer said, with their own agreement that it is published under their name.
//
// There are no ratings or review counts, here or in the structured data: made-up ones can get a whole site penalised.

const https = z.string().url().startsWith("https://");

export const aboutSchema = z.object({
  founders: z.array(z.object({ name: z.string().min(2), role: z.string().min(2), bio: z.string().min(40).max(900), url: https.optional() })),
  social: z.array(z.object({ network: z.string().min(2), url: https })),
  stories: z.array(z.object({ name: z.string().min(2), role: z.string().min(2).optional(), gym: z.string().min(2).optional(), city: z.string().min(2).optional(), quote: z.string().min(20).max(600), permission: z.literal(true) })),
});

export type AboutData = z.infer<typeof aboutSchema>;

export const ABOUT: AboutData = aboutSchema.parse(data);
