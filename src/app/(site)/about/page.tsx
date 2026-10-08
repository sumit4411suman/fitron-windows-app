import { pageMetadata } from "@/lib/seo";
import { AboutView } from "./about-view";

export const metadata = pageMetadata({
  title: "About FITRON | AI Personal Trainer and Gym Software",
  description: "FITRON is a fitness technology platform for India: an AI personal trainer for individuals, and gym accounting and management software for gyms.",
  path: "/about",
});


export default function AboutPage() {
  return <AboutView />;
}
