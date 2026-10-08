import type { Metadata } from "next";
import { Source_Serif_4 } from "next/font/google";
import "./globals.css";
import { SITE_NAME, SITE_URL } from "@/lib/seo";
import { THEME_SCRIPT } from "@/lib/theme-script";

const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  // The prototype stack: Source Serif 4, then the system UI font.
  fallback: ["system-ui", "sans-serif"],
  adjustFontFallback: false,
  // Only the signed-in console (and the sign-in forms) are set in this font. The public pages use the home page's fonts,
  // so preloading it there was 51 KB nobody used, ahead of the fonts they do use.
  preload: false,
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_NAME,
  description: "Gym management and accounting",
  applicationName: SITE_NAME,
  // The console, sign-in and member pages stay out of search results. The public pages (pageMetadata in
  // src/lib/seo.ts) say index; the home page and the AI Trainer are static files with their own tags.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IN" className={`${sourceSerif.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
