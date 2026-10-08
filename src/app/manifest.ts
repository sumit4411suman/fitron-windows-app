import type { MetadataRoute } from "next";

// The web app manifest: the name, colours and icon a phone or a search result shows for fitron.in.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FITRON: AI Personal Trainer & Gym Accounting",
    short_name: "FITRON",
    description: "An AI personal trainer and gym accounting software for India.",
    start_url: "/",
    display: "standalone",
    background_color: "#0e0d0a",
    theme_color: "#0e0d0a",
    lang: "en-IN",
    icons: [{ src: "/fitron-mark.png", sizes: "any", type: "image/png" }],
  };
}
