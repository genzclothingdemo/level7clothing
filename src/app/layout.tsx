import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { getSettings } from "@/lib/settings";
import { getUserSession } from "@/lib/user-auth";
import { prisma } from "@/lib/prisma";
import { siteUrl } from "@/lib/site-url";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

// Display face for headings/product names — modern grotesk with a technical
// edge that suits streetwear far better than an editorial serif.
const grotesk = Space_Grotesk({
  variable: "--font-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// Ensures mobile browsers render at the device width instead of a zoomed-out
// desktop layout. Without this the whole site looks "zoomed" on phones.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Shrink the layout viewport when the on-screen keyboard opens, so fixed
  // elements stay anchored to the visible area instead of drifting behind it.
  interactiveWidget: "resizes-content",
};

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings();
  const base = siteUrl();
  const title = `${s.brandName} — ${s.tagline}`;

  return {
    // Required for relative OG/canonical URLs to resolve; without it Next
    // silently drops them and social cards render blank.
    metadataBase: new URL(base),
    title: { default: title, template: `%s · ${s.brandName}` },
    description: s.heroSubtext,
    keywords: [
      "oversized t-shirts",
      "graphic tees",
      "drop-shoulder hoodies",
      "unisex streetwear",
      "premium cotton tees India",
      s.brandName,
    ],
    alternates: { canonical: "/" },
    openGraph: {
      title,
      description: s.heroSubtext,
      url: base,
      siteName: s.brandName,
      type: "website",
      locale: "en_IN",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: s.heroSubtext,
    },
    robots: { index: true, follow: true },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const settings = await getSettings();
  const {
    defaultMaterialsCare: _dmc,
    defaultShippingInfo: _dsi,
    defaultReturnsInfo: _dri,
    ...clientSettings
  } = settings;

  // If the shopper is logged in, hand their name/phone to the cart so the
  // add-to-cart mini sign-up never prompts them again.
  const session = await getUserSession();
  let initialLead: { name: string; phone: string } | null = null;
  if (session) {
    const u = await prisma.user
      .findUnique({ where: { id: session.id }, select: { name: true, phone: true } })
      .catch(() => null);
    if (u) initialLead = { name: u.name, phone: u.phone ?? "" };
  }

  const base = siteUrl();

  // Site-wide structured data: who the brand is (knowledge panel) and how to
  // search it (sitelinks searchbox). Per-page Product/Breadcrumb graphs live
  // on their own routes.
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${base}/#organization`,
        name: settings.brandName,
        url: base,
        description: settings.heroSubtext,
        ...(settings.logoUrl ? { logo: settings.logoUrl } : {}),
        ...(settings.instagram || settings.facebook
          ? { sameAs: [settings.instagram, settings.facebook].filter(Boolean) }
          : {}),
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "customer service",
          email: settings.contactEmail,
          telephone: settings.contactPhone,
          areaServed: "IN",
          availableLanguage: ["en", "hi"],
        },
      },
      {
        "@type": "WebSite",
        "@id": `${base}/#website`,
        url: base,
        name: settings.brandName,
        publisher: { "@id": `${base}/#organization` },
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${base}/shop?q={search_term_string}`,
          },
          "query-input": "required name=search_term_string",
        },
      },
    ],
  };

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${grotesk.variable} h-full`}
    >
      <body className="min-h-full flex flex-col antialiased">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {/* Server-only fields (the product-page default copy) are stripped here
            so they don't ride along in every page's client payload. */}
        <Providers settings={clientSettings} initialLead={initialLead}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
