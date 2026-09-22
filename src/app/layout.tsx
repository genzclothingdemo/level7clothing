import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { PwaRegister } from "@/components/store/pwa-register";
import { RouteProgress } from "@/components/store/route-progress";
import { UpdateWatcher } from "@/components/store/update-watcher";
import { buildId } from "@/lib/build-id";
import { getMyWishlist } from "@/app/actions/wishlist";
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
  // Tints the browser/status bar so it meets the announcement bar (which is
  // `bg-foreground`) without a seam — most visible as an installed app.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0a0a0a" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
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
    // NO `alternates.canonical` here on purpose. Next merges metadata
    // shallowly, so a canonical set at the root is inherited verbatim by every
    // page that doesn't override it — which pointed /contact, /track-order and
    // eleven other routes at the homepage and made them unrankable. Each route
    // declares its own; the homepage's lives in `(store)/page.tsx`.
    applicationName: s.brandName,
    // iOS ignores the web manifest, so the installed-app title, status bar and
    // home-screen icon have to be declared separately here.
    appleWebApp: {
      capable: true,
      title: s.brandName,
      statusBarStyle: "black-translucent",
    },
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "any" },
        { url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
        { url: "/icons/icon-512.png", type: "image/png", sizes: "512x512" },
      ],
      apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
    },
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

  // Saved products for a signed-in customer. Rendered server-side so the
  // hearts are already filled on first paint; guests resolve theirs from
  // localStorage inside WishlistProvider.
  const wishlistSlugs = session ? await getMyWishlist() : [];

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
      {/*
        `pt-safe` / `px-safe` are what stop `viewportFit: "cover"` above from
        putting the top bar under an iPhone's Dynamic Island once the store is
        installed to the home screen. They are on `body` rather than on each
        bar on purpose: the announcement strip, the promo banner and the sticky
        header are all candidates for "the thing currently at the top edge", and
        padding whichever one happens to be first is how you end up with a
        59px gap between two of them. One inset, on the scroll container, and
        every top-anchored element inherits the right starting point.

        Both resolve to 0px in a browser tab, so nothing changes off-device.
      */}
      <body className="min-h-full flex flex-col antialiased pt-safe px-safe">
        {/* Paints the band the status bar sits in, so content scrolling past
            it is hidden behind an opaque strip instead of appearing under the
            clock. Zero-height wherever there is no inset. */}
        <div className="status-bar-scrim" aria-hidden="true" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {/* `useSearchParams` inside RouteProgress needs its own boundary, or it
            would opt the whole tree into client-side rendering. */}
        <Suspense fallback={null}>
          <RouteProgress />
        </Suspense>

        {/* Server-only fields (the product-page default copy) are stripped here
            so they don't ride along in every page's client payload. */}
        <Providers
          settings={clientSettings}
          initialLead={initialLead}
          wishlist={{ signedIn: !!session, slugs: wishlistSlugs }}
        >
          {children}
        </Providers>

        <PwaRegister />
        <UpdateWatcher current={buildId()} />
      </body>
    </html>
  );
}
