import { ImageResponse } from "next/og";
import { DEFAULT_SETTINGS, getSettings } from "@/lib/settings";

export const alt = "Premium graphic tees and hoodies";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Default social card for any page without its own image (home, shop, policy
 * pages). Product pages override this with the actual photograph.
 *
 * Rendered with Satori, which supports only a subset of CSS — plain flexbox and
 * inline styles, no Tailwind classes. Colours are the Level7 palette written
 * out literally, because Satori cannot resolve the CSS custom properties the
 * rest of the app themes with.
 */
export default async function Image() {
  const s = await getSettings().catch(() => null);
  const brand = s?.brandName ?? DEFAULT_SETTINGS.brandName;
  const tagline = s?.tagline ?? DEFAULT_SETTINGS.tagline;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
          color: "#fafafa",
          padding: 80,
        }}
      >
        <div
          style={{
            fontSize: 26,
            letterSpacing: 10,
            textTransform: "uppercase",
            color: "#a78bfa",
            display: "flex",
          }}
        >
          Made in India
        </div>
        <div
          style={{
            fontSize: 104,
            fontWeight: 700,
            marginTop: 28,
            letterSpacing: -2,
            textTransform: "uppercase",
            display: "flex",
          }}
        >
          {brand}
        </div>
        <div
          style={{
            fontSize: 36,
            marginTop: 20,
            color: "#a1a1aa",
            textAlign: "center",
            maxWidth: 860,
            display: "flex",
          }}
        >
          {tagline}
        </div>
        <div
          style={{
            marginTop: 48,
            height: 4,
            width: 140,
            background: "#7c3aed",
            display: "flex",
          }}
        />
      </div>
    ),
    size
  );
}
