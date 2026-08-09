/**
 * The site's public origin, with no trailing slash.
 *
 * Everything canonical-facing (metadataBase, sitemap, robots, JSON-LD, OG tags)
 * must agree on one origin, so this is the single source of truth — do not
 * inline `process.env.NEXT_PUBLIC_SITE_URL` anywhere else.
 *
 * Set NEXT_PUBLIC_SITE_URL in Vercel. Without it, previews fall back to the
 * deployment URL and local dev to localhost, both of which would emit wrong
 * canonicals if they ever reached production.
 */
export function siteUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/** Turn a relative path into an absolute URL on the canonical origin. */
export function absoluteUrl(path: string): string {
  return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}
