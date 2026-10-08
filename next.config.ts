import type { NextConfig } from "next";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  // Shown in Settings › Help & support › System details.
  env: {
    APP_VERSION: pkg.version,
    APP_COMMIT: (process.env.VERCEL_GIT_COMMIT_SHA || process.env.RENDER_GIT_COMMIT || process.env.SOURCE_VERSION || process.env.GIT_COMMIT || "").slice(0, 7),
  },
  experimental: {
    // Data import sends up to 5,000 CSV rows, member documents up to 10 MB, and backup files
    // (Settings › Backup › Restore from file) up to 60 MB, to server actions.
    serverActions: { bodySizeLimit: "64mb" },
  },
  // The invoice PDF reads its font from disk; ship it with the server build.
  outputFileTracingIncludes: {
    "/invoices/[id]/pdf": ["./node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf", "./node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf"],
  },
  // fitron.in itself is the static marketing site in public/site; the console lives under its own paths.
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/", destination: "/site/index.html" },
        // The AI Trainer member app is a static page in public/trainer.
        { source: "/trainer", destination: "/trainer/index.html" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          // Browsers only honour this over HTTPS, so it is harmless in development.
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // The attendance screen scans member QR codes with the device camera, so the camera is allowed for our own pages
          // (and only ours: an embedded frame still can't use it). Microphone and location are never used.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
      // The Gym Accounting and AI Coach live demos (self-contained prototypes) are shown in a frame on the home page, so
      // our own pages, and only ours, may frame them. Later rules win for the same header.
      { source: "/site/gym-demo.html", headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }] },
      { source: "/site/coach-demo.html", headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }] },
      { source: "/site/partner-demo.html", headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }] },
      // Static files of the home page. Next sends public/ files with max-age=0, so every visit asked for the 1.2 MB 3D
      // library and the screenshots again. The fonts have hashed names and never change; the images and the library
      // may be replaced under the same name, so they are only kept for a day (then served while they refresh).
      // The two small page scripts (fitron-page.js, fitron-3d.js) are left alone so a deploy never mixes versions.
      { source: "/site/fonts/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      { source: "/site/:file(.*\\.(?:webp|png))", headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }] },
      { source: "/site/three.module.js", headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }] },
    ];
  },
};

export default nextConfig;
