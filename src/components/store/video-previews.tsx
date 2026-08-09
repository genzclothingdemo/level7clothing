"use client";

import { useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, ExternalLink, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { PROVIDER_LABEL, type ResolvedVideo } from "@/lib/videos";

/**
 * "Video previews" — the admin's YouTube / Instagram links as a horizontally
 * scrollable rail below the info accordion.
 *
 * Cards start as a poster with a play button and only mount the iframe once
 * clicked. Five embeds mounted on page load would pull in several hundred KB of
 * third-party player script and hand every visitor to YouTube's tracking before
 * they showed any interest in a video.
 */
export function VideoPreviews({ videos }: { videos: ResolvedVideo[] }) {
  const [playing, setPlaying] = useState<number | null>(null);

  if (videos.length === 0) return null;

  return (
    <section className="mt-10 md:mt-14">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl md:text-3xl">Video previews</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            See the piece, the making and the packaging on video
          </p>
        </div>
        {videos.length > 2 && (
          <p className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground md:flex">
            <ChevronLeft className="h-3.5 w-3.5" />
            scroll
            <ChevronRight className="h-3.5 w-3.5" />
          </p>
        )}
      </div>

      {/* Full-bleed on mobile so the rail scrolls edge to edge. */}
      <div className="-mx-5 mt-5 sm:mx-0">
        <div className="no-scrollbar flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-2 sm:px-0">
          {videos.map((v, i) => {
            const isPlaying = playing === i;
            return (
              <div
                key={`${v.url}-${i}`}
                className={cn(
                  "shrink-0 snap-start",
                  // Portrait for reels/shorts, landscape for everything else —
                  // a 9:16 reel letterboxed into 16:9 wastes most of the card.
                  v.vertical ? "w-[220px]" : "w-[300px] sm:w-[340px]"
                )}
              >
                <div
                  className={cn(
                    "relative overflow-hidden rounded-2xl border border-border bg-muted",
                    v.vertical ? "aspect-[9/16]" : "aspect-video"
                  )}
                >
                  {isPlaying && v.embedUrl ? (
                    <iframe
                      src={v.embedUrl}
                      title={v.title}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      loading="lazy"
                      referrerPolicy="strict-origin-when-cross-origin"
                      className="absolute inset-0 h-full w-full"
                    />
                  ) : (
                    <PosterCard
                      video={v}
                      onPlay={() => v.embedUrl && setPlaying(i)}
                    />
                  )}
                </div>

                <div className="mt-2 flex items-start justify-between gap-2">
                  <p className="line-clamp-2 text-sm font-medium leading-snug">
                    {v.title}
                  </p>
                  <a
                    href={v.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-accent"
                    aria-label={`Open on ${PROVIDER_LABEL[v.provider]}`}
                    title={`Open on ${PROVIDER_LABEL[v.provider]}`}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {PROVIDER_LABEL[v.provider]}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** Poster + play button, or a link-out card when the host can't be embedded. */
function PosterCard({
  video,
  onPlay,
}: {
  video: ResolvedVideo;
  onPlay: () => void;
}) {
  const canEmbed = !!video.embedUrl;

  const inner = (
    <>
      {video.thumbnailUrl ? (
        <Image
          src={video.thumbnailUrl}
          alt=""
          fill
          sizes="340px"
          className="object-cover transition-transform duration-500 group-hover:scale-105"
        />
      ) : (
        // No public poster (Instagram / Facebook / unknown host) — a branded
        // gradient reads as intentional, a broken image doesn't.
        <span className="absolute inset-0 bg-gradient-to-br from-accent/20 via-muted to-primary/20" />
      )}

      <span className="absolute inset-0 bg-black/15 transition-colors group-hover:bg-black/25" />

      <span className="absolute left-1/2 top-1/2 grid h-14 w-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-black shadow-lg backdrop-blur transition-transform group-hover:scale-110">
        {canEmbed ? (
          <Play className="ml-0.5 h-6 w-6 fill-current" />
        ) : (
          <ExternalLink className="h-5 w-5" />
        )}
      </span>

      <span className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur">
        {PROVIDER_LABEL[video.provider]}
      </span>
    </>
  );

  // Embeddable → play in place. Otherwise the whole poster is the link out.
  return canEmbed ? (
    <button
      type="button"
      onClick={onPlay}
      aria-label={`Play ${video.title}`}
      className="group absolute inset-0 h-full w-full cursor-pointer"
    >
      {inner}
    </button>
  ) : (
    <a
      href={video.url}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open ${video.title}`}
      className="group absolute inset-0 block h-full w-full"
    >
      {inner}
    </a>
  );
}
