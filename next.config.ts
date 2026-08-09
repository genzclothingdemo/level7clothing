import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
