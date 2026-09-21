/**
 * The social grid shown on the homepage and at /instagram.
 *
 * These are curated catalogue shots, NOT live Instagram content. Pulling real
 * posts and reels needs the Instagram Graph API: a Business/Creator account
 * linked to a Facebook Page, an app, and a long-lived access token that has to
 * be refreshed every 60 days. None of that is configured here, and inventing a
 * fake "live feed" would be worse than an honest curated one.
 *
 * To make it real later: store the token as `INSTAGRAM_ACCESS_TOKEN`, fetch
 * `/me/media?fields=id,caption,media_type,media_url,permalink,thumbnail_url`,
 * cache it (the rate limit is low and the token is per-hour throttled), and
 * swap `CURATED_POSTS` for that result. Keep this file as the fallback for
 * when the token expires — an empty grid on the homepage is a visible outage.
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
