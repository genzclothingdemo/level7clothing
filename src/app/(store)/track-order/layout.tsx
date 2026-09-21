import type { Metadata } from "next";
import { getSettings } from "@/lib/settings";

/**
 * Client component (order-number form), so metadata lives here. Same problem
 * as /contact: indexable in sitemap.xml, but previously a byte-for-byte
 * duplicate of the homepage's title and description.
 */
export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings();
  const title = "Track your order";
  const description = `Track a ${s.brandName} order — enter your order number for live courier status, dispatch updates and the expected delivery date.`;

  return {
    title,
    description,
    alternates: { canonical: "/track-order" },
    openGraph: {
      title: `${title} · ${s.brandName}`,
      description,
      url: "/track-order",
      siteName: s.brandName,
      type: "website",
      locale: "en_IN",
    },
    twitter: { card: "summary_large_image", title: `${title} · ${s.brandName}`, description },
  };
}

export default function TrackOrderLayout({ children }: { children: React.ReactNode }) {
  return children;
}
