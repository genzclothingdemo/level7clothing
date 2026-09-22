import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root.
  //
  // Turbopack infers the root by walking up for a lockfile, and there is a
  // stray package.json + package-lock.json in the user's home directory. It
  // therefore inferred `C:\Users\15ind` as the root and wrote build output
  // against that path, which surfaced as a bogus
  // `ENOENT .next/server/pages-manifest.json` at the end of `next build`
  // (this app is App Router only, so that manifest is never emitted).
  turbopack: { root: path.join(__dirname) },

  /**
   * /instagram is now /portfolio — the page grew past Instagram into reels,
   * blog links, collaborations and bulk-order work, and one table with two
   * pages on it is the "two editors" trap.
   *
   * Done here rather than with `redirect()` inside the page: the `(store)`
   * segment has a layout, a template and a loading file, so a response is
   * already streaming by the time a page-level redirect throws — it degrades
   * to a `200` with a `<meta http-equiv="refresh">`, which browsers follow but
   * crawlers weight far less. This emits a real 308 before any rendering.
   */
  async redirects() {
    return [{ source: "/instagram", destination: "/portfolio", permanent: true }];
  },
  images: {
    remotePatterns: [
      // Admin-uploaded product photos are stored on Vercel Blob.
      { protocol: "https", hostname: "**.public.blob.vercel-storage.com" },
      // Poster frames for the product "Video previews" rail. Only YouTube serves
      // a public thumbnail without an API key — Instagram/Facebook cards fall
      // back to a branded placeholder, so no other host is needed here.
      { protocol: "https", hostname: "i.ytimg.com", pathname: "/vi/**" },
    ],
  },
};

export default nextConfig;
