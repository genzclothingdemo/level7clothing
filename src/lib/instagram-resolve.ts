/**
 * Resolve one public Instagram permalink into the fields the portfolio needs.
 *
 * ── Why this exists, and what was measured ───────────────────────────────────
 *
 * The admin form used to demand that the owner paste a thumbnail URL by hand
 * next to the post URL. The obvious thing to paste is the image address copied
 * out of Instagram — and that is a trap, which is the whole reason this module
 * exists:
 *
 * **`scontent.cdninstagram.com` URLs are signed and expire.** The `oe=`
 * parameter is a hex unix timestamp. Measured on 2026-09-22 against the three
 * real posts this was built with: `oe=6AB815B0` → 2026-09-26, i.e. **four
 * days**. A portfolio built by pasting those addresses looks perfect on the day
 * it is made and is a grid of broken images the following week, with nothing in
 * any log to say why.
 *
 * So the CDN address is treated as a *source to copy from*, never as something
 * to store. `importInstagramThumbnail` in `actions/portfolio.ts` fetches the
 * bytes once and puts them in Vercel Blob; `PortfolioItem.imageUrl` then holds
 * a permanent address we own.
 *
 * ── What is and is not possible without an access token ──────────────────────
 *
 * Tested, not assumed:
 *
 * | Attempt | Result |
 * |---|---|
 * | `api.instagram.com/oembed` | empty — the public endpoint was retired in 2020 |
 * | `GET /p/<code>/` + `og:` tags | **works**, returns image, caption and author |
 * | `GET /p/<code>/embed` | **works** (200, also for `/reel/`) |
 * | `GET /<handle>/` for a post list | **login wall, zero shortcodes** |
 *
 * That last row is the honest answer to "scrape every post from the profile":
 * Instagram serves the grid only to an authenticated session. A live mirror of
 * a whole account needs `INSTAGRAM_ACCESS_TOKEN` and the Graph API — the seam
 * for which already exists in `lib/portfolio.ts` (`fetchInstagramMedia`). This
 * module is the per-post path that works with no credentials at all, which is
 * what a shop owner pasting a link actually needs.
 *
 * Fetching a page's Open Graph tags is what every link preview in every chat
 * app does; it is not a circumvention of anything and it reads only what
 * Instagram serves anonymously.
 */

export type ResolvedInstagramPost = {
  /** Canonical permalink, normalised — no query string, no tracking token. */
  url: string;
  shortcode: string;
  /** The caption Instagram puts in `og:title`, trimmed of its boilerplate. */
  title: string | null;
  /**
   * The handle that actually published it, read from `og:url`.
   *
   * Worth surfacing rather than ignoring: one of the three links this was
   * built against resolved to `therishithakor`, not `level7clothing`. Posting
   * a creator's reel under your own portfolio without noticing is a
   * credit problem, so the caller is told and decides.
   */
  author: string | null;
  /** **Expires.** Copy the bytes; never store this address. */
  thumbnailUrl: string | null;
  /** Stable — Instagram resolves the shortcode itself. Safe to store. */
  embedUrl: string;
};

/** `/p/<code>/`, `/reel/<code>/`, `/tv/<code>/`, with or without a handle. */
const SHORTCODE = /\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/;

/**
 * **Do not send a browser user agent here.** This is inverted from what you
 * would guess, and it cost a debugging round to find.
 *
 * Instagram decides what to serve by user agent. Measured on 2026-09-22
 * against the same post, same second:
 *
 * | user agent | `og:image` present |
 * |---|---|
 * | Chrome 131 | **no** — 630 KB client-rendered app shell, zero meta tags |
 * | `facebookexternalhit` | yes |
 * | WhatsApp | yes |
 * | no UA at all | yes |
 * | a self-identified bot | yes |
 *
 * A browser is handed the React app and expected to render it; a crawler is
 * handed the Open Graph tags. So we identify honestly as what we are — a link
 * previewer — rather than pretending to be Chrome, which is both the truthful
 * thing and the one that works.
 */
const UA = "Level7ClothingBot/1.0 (+link preview; https://clothingdemoshop.vercel.app)";

export function instagramShortcode(raw: string): string | null {
  if (!raw?.trim()) return null;
  try {
    const u = new URL(raw.trim());
    if (!/(^|\.)instagram\.com$/i.test(u.hostname)) return null;
    return SHORTCODE.exec(u.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Canonical `https://www.instagram.com/p/<code>/` — no tracking parameters. */
export function instagramPermalink(shortcode: string): string {
  return `https://www.instagram.com/p/${shortcode}/`;
}

export function instagramEmbedUrl(shortcode: string): string {
  return `https://www.instagram.com/p/${shortcode}/embed`;
}

/** `&amp;` in an attribute is not the same URL. Meta content is escaped. */
function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2122;/g, "™")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function ogTag(html: string, property: string): string | null {
  const re = new RegExp(
    `<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["']`,
    "i"
  );
  const hit = re.exec(html)?.[1];
  return hit ? decodeEntities(hit).trim() || null : null;
}

/**
 * `og:title` reads `LEVEL7™ on Instagram: "Not every day calls for graphics."`
 * The useful part is the quoted caption; the rest is the same on every post.
 */
function captionFrom(ogTitle: string | null): string | null {
  if (!ogTitle) return null;
  // `[\s\S]` rather than the `s` flag — this project's tsconfig targets a
  // version where `dotAll` is not allowed, and a caption can span lines.
  const quoted = /["“]([\s\S]+)["”]\s*$/.exec(ogTitle)?.[1];
  const text = (quoted ?? ogTitle).trim();
  if (!text || /^instagram$/i.test(text)) return null;
  // One line: a caption can run for paragraphs and this becomes a card title.
  const firstLine = text.split(/\r?\n/)[0].trim();
  return firstLine.length > 90 ? `${firstLine.slice(0, 87).trimEnd()}…` : firstLine;
}

/** `https://www.instagram.com/therishithakor/reel/DF0.../` → `therishithakor` */
function authorFrom(ogUrl: string | null): string | null {
  if (!ogUrl) return null;
  try {
    const first = new URL(ogUrl).pathname.split("/").filter(Boolean)[0];
    if (!first || ["p", "reel", "reels", "tv"].includes(first)) return null;
    return first;
  } catch {
    return null;
  }
}

/**
 * Fetch one post's public metadata. Returns `null` for anything that is not a
 * resolvable Instagram permalink — a private post, a deleted one, a rate-limit,
 * or a URL that was never Instagram. The caller degrades to "save it as a plain
 * link", which is always valid: `url` alone makes a working portfolio row.
 */
export async function resolveInstagramPost(
  rawUrl: string,
  { timeoutMs = 12_000 }: { timeoutMs?: number } = {}
): Promise<ResolvedInstagramPost | null> {
  const shortcode = instagramShortcode(rawUrl);
  if (!shortcode) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(instagramPermalink(shortcode), {
      headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
      signal: controller.signal,
      // Never serve a shop page from a cached scrape of somebody else's site.
      cache: "no-store",
    });
    if (!res.ok) return null;
    const html = await res.text();

    const image = ogTag(html, "og:image");
    const title = captionFrom(ogTag(html, "og:title"));
    const author = authorFrom(ogTag(html, "og:url"));

    // No image AND no caption means we were served the login wall, not a post.
    if (!image && !title) return null;

    return {
      url: instagramPermalink(shortcode),
      shortcode,
      title,
      author,
      thumbnailUrl: image,
      embedUrl: instagramEmbedUrl(shortcode),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
