import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Private, transactional or machine-only surfaces. Crawling these wastes
        // budget at best and indexes a customer's order at worst.
        disallow: [
          "/admin",
          "/account",
          "/checkout",
          "/cart",
          "/order",
          "/api",
        ],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
