/**
 * Instagram helpers that are safe to import from anywhere.
 *
 * This file used to own the storefront's social grid as a hardcoded
 * `CURATED_POSTS` array. That grid is now **admin-managed**: it lives in the
 * `PortfolioItem` table, is edited at `/admin/portfolio` and rendered at
 * `/portfolio`. See `lib/portfolio.ts`, which also holds the single seam where
 * a real Instagram Graph API token would turn the page into a live mirror.
 *
 * What is left here is deliberately Prisma-free, so a **client** component can
 * import it. `lib/portfolio.ts` imports the database client and cannot be
 * imported across that boundary — keep the split.
 *
 * `CURATED_POSTS` is kept as the last-resort fallback for the homepage strip:
 * an empty grid on the homepage is a visible outage, and the table is empty
 * until the owner adds their first piece. It is not shown once there is real
 * content, and `/portfolio` never uses it.
 */

export type SocialPost = {
  src: string;
  /** Meaningful alt text; these are real garments, not decoration. */
  alt: string;
};

export const CURATED_POSTS: SocialPost[] = [
  { src: "/products/level7/Level7_Core_Style.png", alt: "Core oversized tee styled with wide-leg denim" },
  { src: "/products/level7/05.10.2024-182.jpg", alt: "Graphic tee photographed on location" },
  { src: "/products/level7/Level7_Planet_Seat.png", alt: "Planet print tee, seated studio shot" },
  { src: "/products/level7/05.10.2024-128.jpg", alt: "Drop-shoulder fit, front view" },
  { src: "/products/level7/Level7_Core_Walk.png", alt: "Core tee in motion, street shot" },
  { src: "/products/level7/05.10.2024-175.jpg", alt: "Oversized silhouette, back print detail" },
];

/** Normalises whatever the admin saved into a usable @handle. */
export function instagramHandle(instagramUrl?: string | null): string {
  if (!instagramUrl) return "@level7clothing";
  const cleaned = instagramUrl
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/\/+$/, "")
    .trim();
  if (!cleaned || cleaned.includes("/")) return "@level7clothing";
  return cleaned.startsWith("@") ? cleaned : `@${cleaned}`;
}
