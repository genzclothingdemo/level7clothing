/**
 * Resolve one public social permalink — Instagram or YouTube — into the fields
 * the portfolio needs, with **no access token of any kind**.
 *
 * The filename still says Instagram because that is where this started and
 * renaming it would churn three importers for nothing; the YouTube half lives
 * at the bottom of the file and shares the same contract:
 *
 *   permalink in → `{ url, title, author, thumbnailUrl, embedUrl }` out, or
 *   `null` when the link is not readable, in which case the caller saves it as
 *   a plain link and nothing is lost.
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

/** Which site a resolved permalink came from. Drives the copy the admin sees. */
/**
 * `link` is the catch-all: any other public https page, read for its Open
 * Graph tags. It is what lets the owner paste **anything** and get a title and
 * a poster back, rather than only the two networks having a fetch button.
 */
export type SocialProvider = "instagram" | "youtube" | "link";

export type ResolvedInstagramPost = {
  provider: SocialProvider;
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
  /**
   * **Instagram: expires.** Copy the bytes; never store this address.
   * **YouTube: permanent** (`i.ytimg.com`, which `next.config.ts` already
   * allows), so a copy is a nicety there rather than a necessity.
   */
  thumbnailUrl: string | null;
  /**
   * Whether `thumbnailUrl` is safe to store as-is.
   *
   * This is the one real difference between the two providers and the caller
   * has to know it: an Instagram CDN address is a four-day fuse, a YouTube
   * poster frame is not. `importSocialPost` copies either way when it can, and
   * falls back to storing the address only when this is true.
   */
  thumbnailExpires: boolean;
  /** Stable — the provider resolves the id itself. Safe to store. */
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
      provider: "instagram",
      url: instagramPermalink(shortcode),
      shortcode,
      title,
      author,
      thumbnailUrl: image,
      thumbnailExpires: true,
      embedUrl: instagramEmbedUrl(shortcode),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/*  YouTube                                                            */
/* ------------------------------------------------------------------ */

/**
 * YouTube is the easy half, and it is worth writing down *why* so nobody
 * reaches for the Data API and an API key later:
 *
 * | what | how | key needed |
 * |---|---|---|
 * | title + channel | `youtube.com/oembed?url=…&format=json` | **no** |
 * | poster frame | `i.ytimg.com/vi/<id>/<quality>.jpg` | **no** |
 * | player | `youtube-nocookie.com/embed/<id>` | **no** |
 *
 * The oEmbed endpoint is public, unauthenticated and not rate-limited in any
 * way that matters for an admin pressing a button. It fails for private and
 * age-restricted videos, which is exactly when we want to fall back to a plain
 * link anyway.
 *
 * Unlike Instagram, the poster frame does **not** expire: `i.ytimg.com/vi/**`
 * is already in `next.config.ts`'s `remotePatterns`, so the address can be
 * stored directly and still go through the image optimiser. We copy it into
 * our own blob store anyway when one is configured — one fewer third party in
 * the render path — but the fallback is a real fallback here, not a broken
 * image four days later.
 */

/** The 11-char id out of any shape a person actually pastes. */
export function youtubeId(raw: string): string | null {
  if (!raw?.trim()) return null;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);

  let id: string | null = null;
  if (host === "youtu.be") id = parts[0] ?? null;
  else if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
    id =
      u.searchParams.get("v") ??
      (["shorts", "embed", "live", "v"].includes(parts[0]) ? parts[1] ?? null : null);
  }
  // An id is exactly 11 URL-safe characters. Checking is what stops
  // `youtube.com/@level7` or `/results?search_query=…` resolving to nonsense.
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

/** `/shorts/<id>` is portrait; everything else is 16:9. */
function youtubeVertical(raw: string): boolean {
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return u.pathname.split("/").filter(Boolean)[0] === "shorts";
  } catch {
    return false;
  }
}

export function youtubeEmbedUrl(id: string): string {
  // `-nocookie` and no autoplay: nothing plays until the visitor asks, and the
  // tracking cookie is not set just because a poster was rendered.
  return `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1`;
}

/**
 * Best poster that actually exists.
 *
 * `maxresdefault.jpg` is 1280×720 and is the one worth having, but it is only
 * generated for videos uploaded at that resolution — for everything else it is
 * a hard 404, not a downscale. `hqdefault.jpg` always exists. So we ask for
 * the good one and fall back, which costs one HEAD request inside an admin
 * button press and nothing at render time.
 */
async function bestYoutubePoster(id: string, signal: AbortSignal): Promise<string> {
  const maxres = `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
  try {
    const res = await fetch(maxres, { method: "HEAD", cache: "no-store", signal });
    if (res.ok) return maxres;
  } catch {
    // Network hiccup or abort — the fallback below is always valid.
  }
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

export async function resolveYouTubeVideo(
  rawUrl: string,
  { timeoutMs = 12_000 }: { timeoutMs?: number } = {}
): Promise<ResolvedInstagramPost | null> {
  const id = youtubeId(rawUrl);
  if (!id) return null;

  const vertical = youtubeVertical(rawUrl);
  // Canonical watch URL — no playlist, no `t=`, no `si=` share token.
  const canonical = vertical
    ? `https://www.youtube.com/shorts/${id}`
    : `https://www.youtube.com/watch?v=${id}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      canonical
    )}&format=json`;

    const [res, poster] = await Promise.all([
      fetch(oembed, { cache: "no-store", signal: controller.signal }).catch(() => null),
      bestYoutubePoster(id, controller.signal),
    ]);

    let title: string | null = null;
    let author: string | null = null;

    if (res?.ok) {
      const json = (await res.json().catch(() => null)) as {
        title?: string;
        author_name?: string;
      } | null;
      const t = json?.title?.trim() ?? "";
      title = t ? (t.length > 90 ? `${t.slice(0, 87).trimEnd()}…` : t) : null;
      author = json?.author_name?.trim() || null;
    }

    // A private or age-gated video gives no oEmbed. The id is still valid and
    // the poster still renders, so this is worth saving rather than refusing —
    // the caller shows the plain-link warning and the owner types a title.
    return {
      provider: "youtube",
      url: canonical,
      shortcode: id,
      title,
      author,
      thumbnailUrl: poster,
      thumbnailExpires: false,
      embedUrl: youtubeEmbedUrl(id),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/*  One door                                                           */
/* ------------------------------------------------------------------ */

/** Which resolver, if any, can read this link. Cheap and synchronous. */
export function socialProviderOf(rawUrl: string): SocialProvider | null {
  if (instagramShortcode(rawUrl)) return "instagram";
  if (youtubeId(rawUrl)) return "youtube";
  return isFetchableLink(rawUrl) ? "link" : null;
}

/**
 * Whether a pasted address is safe for the **server** to go and fetch.
 *
 * This guard is what stops "paste any URL and we'll mirror it" turning into
 * request forgery. The fetch happens on the server, so without it the admin
 * box could be aimed at `https://169.254.169.254/` (cloud metadata) or at
 * something on the private network behind the function, and the response
 * rendered back into the page.
 *
 * It is a hostname check, not a DNS resolution — someone controlling a domain
 * could still point it inward — but this box already sits behind the admin
 * gate, so the job is preventing an accident, not defeating an adversary.
 */
export function isFetchableLink(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl.trim());
    if (u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return false;
    if (h === "metadata.google.internal") return false;
    if (h === "::1" || h === "[::1]") return false;
    // Bare IPv4: block loopback, link-local and the private ranges outright.
    const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
    if (octets) {
      const a = Number(octets[1]);
      const b = Number(octets[2]);
      if (a === 0 || a === 10 || a === 127) return false;
      if (a === 169 && b === 254) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
      if (a === 192 && b === 168) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Any other public page, read for its Open Graph tags.
 *
 * This is what makes the portfolio "paste anything" rather than "paste one of
 * two networks": a blog post, a press mention, a collaborator's page all come
 * back with a title and a poster, and the thumbnail field becomes optional
 * instead of a chore.
 *
 * `thumbnailExpires: false` — an ordinary site's `og:image` is a plain static
 * address, not Instagram's signed four-day CDN link. `importSocialPost` still
 * copies the bytes when it can, because a third party's image can move, but
 * storing the address is not the trap here that it is for Instagram.
 */
async function resolveGenericLink(
  rawUrl: string,
  { timeoutMs = 12_000 }: { timeoutMs?: number } = {}
): Promise<ResolvedInstagramPost | null> {
  if (!isFetchableLink(rawUrl)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(rawUrl, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      signal: controller.signal,
      redirect: "follow",
      cache: "no-store",
    });
    if (!res.ok) return null;
    if (!(res.headers.get("content-type") ?? "").includes("html")) return null;

    // A page can be megabytes and only the head carries what we want.
    const html = (await res.text()).slice(0, 300_000);

    const rawTitle =
      ogTag(html, "og:title") ??
      (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").trim();
    const title = rawTitle ? decodeEntities(rawTitle) : "";
    const image = ogTag(html, "og:image");
    if (!title && !image) return null;

    const canonical = ogTag(html, "og:url") ?? res.url ?? rawUrl;
    let host: string | null = null;
    try {
      host = new URL(canonical).hostname.replace(/^www\./, "");
    } catch {
      host = null;
    }

    return {
      provider: "link",
      url: canonical,
      shortcode: "",
      title: title ? (title.length > 90 ? `${title.slice(0, 87).trimEnd()}…` : title) : null,
      // The site it came from — the honest equivalent of an author here.
      author: host,
      thumbnailUrl: image,
      thumbnailExpires: false,
      // No embed: most sites refuse to be framed (X-Frame-Options), and a
      // blank iframe is worse than an honest link-out.
      embedUrl: "",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve whatever was pasted. One call site in the admin, one in the seeder.
 *
 * Deliberately **not** a `switch` in the caller: adding Vimeo later means a
 * function here and a line in `socialProviderOf`, and nothing in the action or
 * the form changes.
 */
export async function resolveSocialPost(
  rawUrl: string,
  options?: { timeoutMs?: number }
): Promise<ResolvedInstagramPost | null> {
  switch (socialProviderOf(rawUrl)) {
    case "instagram":
      return resolveInstagramPost(rawUrl, options);
    case "youtube":
      return resolveYouTubeVideo(rawUrl, options);
    case "link":
      return resolveGenericLink(rawUrl, options);
    default:
      return null;
  }
}
