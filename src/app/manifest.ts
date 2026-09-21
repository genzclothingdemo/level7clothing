import type { MetadataRoute } from "next";
import { getSettings } from "@/lib/settings";

/**
 * Web app manifest — this is what makes the store installable ("Add to home
 * screen" / "Install app").
 *
 * Brand strings come from `getSettings()` rather than being hardcoded, same as
 * everywhere else in the store; renaming the brand in Admin → Settings renames
 * the installed app too. `getSettings()` already falls back to defaults if the
 * database is unreachable, so a DB outage degrades the manifest instead of
 * failing the route.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const s = await getSettings();

  return {
    // A stable id keeps the installed app identified across manifest edits —
    // without it, changing start_url can register as a *different* app.
    id: "/",
    name: `${s.brandName} — ${s.tagline}`,
    short_name: s.brandName,
    description: s.heroSubtext,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    lang: "en-IN",
    dir: "ltr",
    categories: ["shopping", "lifestyle"],
    // Splash uses the light base; the theme colour is ink so the status bar
    // meets the announcement bar (which is `bg-foreground`) without a seam.
    background_color: "#fafafa",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Android crops the outer ~20% of a maskable icon into a circle/squircle;
      // these are the variants with the glyph pulled in to survive that.
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Long-press / right-click the installed icon to jump straight in.
    shortcuts: [
      { name: "Shop all", short_name: "Shop", url: "/shop" },
      { name: "Your cart", short_name: "Cart", url: "/cart" },
      { name: "Track an order", short_name: "Track", url: "/track-order" },
      { name: "Wishlist", short_name: "Wishlist", url: "/wishlist" },
    ],
  };
}
