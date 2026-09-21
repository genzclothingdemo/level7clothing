import type { Metadata } from "next";
import { getSettings } from "@/lib/settings";

/**
 * The contact page is a client component (it owns the enquiry form), so its
 * metadata has to live here.
 *
 * It is listed in sitemap.xml as indexable, but without this it rendered the
 * homepage's exact title and description and inherited the root canonical
 * pointing at `/` — so it could never rank for its own terms.
 */
export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings();
  const title = "Contact us";
  const description = `Questions about an order, sizing or a return? Reach ${s.brandName} by email, phone or WhatsApp — most messages get a reply within one working day.`;

  return {
    title,
    description,
    alternates: { canonical: "/contact" },
    openGraph: {
      title: `${title} · ${s.brandName}`,
      description,
      url: "/contact",
      siteName: s.brandName,
      type: "website",
      locale: "en_IN",
    },
    twitter: { card: "summary_large_image", title: `${title} · ${s.brandName}`, description },
  };
}

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children;
}
