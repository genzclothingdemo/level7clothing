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
