import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { getSettings } from "@/lib/settings";
import { getUserSession } from "@/lib/user-auth";
import { prisma } from "@/lib/prisma";

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

function siteUrl() {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings();
  const base = siteUrl();
  return {
    // Lets relative OG/canonical URLs resolve to absolute ones.
    metadataBase: new URL(base),
    title: {
      default: `${s.brandName} — ${s.tagline}`,
      template: `%s · ${s.brandName}`,
    },
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
      title: `${s.brandName} — ${s.tagline}`,
      description: s.heroSubtext,
      url: base,
      siteName: s.brandName,
      type: "website",
      locale: "en_IN",
    },
    twitter: {
      card: "summary_large_image",
      title: `${s.brandName} — ${s.tagline}`,
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

  // Site-wide structured data: identifies the brand to search engines and
  // declares the on-site search endpoint for a potential sitelinks searchbox.
  const orgJsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${base}/#organization`,
        name: settings.brandName,
        url: base,
        description: settings.aboutText,
        ...(settings.logoUrl && {
          logo: settings.logoUrl.startsWith("http")
            ? settings.logoUrl
            : `${base}${settings.logoUrl}`,
        }),
        ...(settings.instagram && { sameAs: [settings.instagram] }),
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "customer support",
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
        description: settings.heroSubtext,
        publisher: { "@id": `${base}/#organization` },
        inLanguage: "en-IN",
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
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
        />
        <Providers settings={settings} initialLead={initialLead}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
