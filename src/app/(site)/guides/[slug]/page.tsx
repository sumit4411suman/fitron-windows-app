import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { findGuide, GUIDES, guidePath } from "@/lib/domain/guides";
import { pageMetadata } from "@/lib/seo";
import { GuideView } from "../../guide-view";

// One guide for gym owners (content in src/lib/domain/guides.ts). Only the guides in that file exist: any other address is
// a 404 from notFound() below.
//
// Do not set `dynamicParams = false` here. The guides are built ahead of time (generateStaticParams), but the console's
// server actions call revalidatePath("/", "layout"), which throws away every cached page, these included. With
// `dynamicParams = false` Next cannot build a thrown-away guide again on request (NoFallbackError), so after the first
// gym owner saved a setting every guide answered 404 until the server restarted. Without it the page is simply built
// again on the next visit.

export function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: PageProps<"/guides/[slug]">): Promise<Metadata> {
  const g = findGuide((await params).slug);
  if (!g) return {};
  const m = pageMetadata({ title: g.title, description: g.description, path: guidePath(g) });
  return { ...m, openGraph: { ...m.openGraph, type: "article", publishedTime: g.published } };
}

export default async function Page({ params }: PageProps<"/guides/[slug]">) {
  const g = findGuide((await params).slug);
  if (!g) notFound();
  return <GuideView guide={g} />;
}
