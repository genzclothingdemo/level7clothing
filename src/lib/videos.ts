// Product video links — parsing whatever URL the admin pasted into something the
// storefront can render.
//
// The admin pastes from the address bar or a share sheet, so every shape a real
// person copies has to work: youtu.be links, /shorts/, /reels/, tracking query
// strings, trailing slashes. Anything we can't recognise still renders as a
// titled card that opens in a new tab — an unknown host is never a dead link.

import type { ProductVideo } from "./types";

export type VideoProvider = "youtube" | "instagram" | "facebook" | "link";

export type ResolvedVideo = {
  title: string;
  url: string;
  provider: VideoProvider;
  /** Embeddable src for an iframe, or null when only a link-out is possible. */
  embedUrl: string | null;
  /** Poster image, or null — then the card falls back to a branded placeholder. */
  thumbnailUrl: string | null;
  /** Portrait framing for reels/shorts; landscape 16:9 otherwise. */
  vertical: boolean;
};

/** Strip a trailing slash so path segments split cleanly. */
function segments(pathname: string): string[] {
  return pathname.split("/").filter(Boolean);
}

/** The 11-char YouTube id, from any of the shapes people actually paste. */
function youtubeId(u: URL): { id: string | null; vertical: boolean } {
  const parts = segments(u.pathname);

  // youtu.be/VIDEOID
  if (u.hostname.endsWith("youtu.be")) {
    return { id: parts[0] ?? null, vertical: false };
  }
  // youtube.com/watch?v=VIDEOID
  const v = u.searchParams.get("v");
  if (v) return { id: v, vertical: false };
  // /shorts/ID (portrait), /embed/ID, /live/ID
  const kind = parts[0];
  if (kind === "shorts") return { id: parts[1] ?? null, vertical: true };
  if (kind === "embed" || kind === "live" || kind === "v") {
    return { id: parts[1] ?? null, vertical: false };
  }
  return { id: null, vertical: false };
}

/** Instagram post/reel shortcode. Reels are portrait. */
function instagramCode(u: URL): { code: string | null; vertical: boolean } {
  const parts = segments(u.pathname);
  const i = parts.findIndex((p) => ["p", "reel", "reels", "tv"].includes(p));
  if (i === -1) return { code: null, vertical: false };
  return {
    code: parts[i + 1] ?? null,
    vertical: parts[i] !== "p",
  };
}

/**
 * Turn one admin-entered link into something renderable. Never throws — a
 * malformed URL degrades to a plain link card rather than breaking the page.
 */
export function resolveVideo(video: ProductVideo): ResolvedVideo {
  const title = video.title?.trim() || "Watch";
  const raw = video.url?.trim() ?? "";
  const fallback: ResolvedVideo = {
    title,
    url: raw,
    provider: "link",
    embedUrl: null,
    thumbnailUrl: null,
    vertical: false,
  };
  if (!raw) return fallback;

  let u: URL;
  try {
    // Tolerate a pasted link with no scheme ("instagram.com/reel/…").
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return fallback;
  }

  const host = u.hostname.replace(/^www\./, "").toLowerCase();

  if (host.endsWith("youtube.com") || host.endsWith("youtu.be")) {
    const { id, vertical } = youtubeId(u);
    if (!id) return { ...fallback, provider: "youtube", url: u.toString() };
    return {
      title,
      url: u.toString(),
      provider: "youtube",
      // Nothing autoplays: the iframe is only mounted after a deliberate click.
      embedUrl: `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1`,
      thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      vertical,
    };
  }

  if (host.endsWith("instagram.com")) {
    const { code, vertical } = instagramCode(u);
    if (!code) return { ...fallback, provider: "instagram", url: u.toString() };
    return {
      title,
      url: u.toString(),
      provider: "instagram",
      embedUrl: `https://www.instagram.com/${vertical ? "reel" : "p"}/${code}/embed`,
      // Instagram doesn't serve a public poster without the Graph API, so the
      // card uses its branded placeholder instead of a broken image.
      thumbnailUrl: null,
      vertical,
    };
  }

  if (host.endsWith("facebook.com") || host.endsWith("fb.watch")) {
    return {
      title,
      url: u.toString(),
      provider: "facebook",
      embedUrl: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(
        u.toString()
      )}&show_text=false`,
      thumbnailUrl: null,
      vertical: false,
    };
  }

  return { ...fallback, url: u.toString() };
}

/** Drop blank rows and resolve the rest. Used by the storefront and the admin. */
export function resolveVideos(input: unknown): ResolvedVideo[] {
  const list = Array.isArray(input) ? (input as ProductVideo[]) : [];
  return list
    .filter((v) => v && typeof v.url === "string" && v.url.trim())
    .map(resolveVideo);
}

export const PROVIDER_LABEL: Record<VideoProvider, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  facebook: "Facebook",
  link: "Video",
};
