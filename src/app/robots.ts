import type { MetadataRoute } from "next";

function baseUrl() {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export default function robots(): MetadataRoute.Robots {
  const base = baseUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Private / transactional areas have no SEO value.
        disallow: ["/admin", "/account", "/checkout", "/cart", "/order", "/api"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
