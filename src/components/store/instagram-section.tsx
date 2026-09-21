"use client";

import Image from "next/image";
import { useSettings } from "@/context/settings";
import { CURATED_POSTS, instagramHandle } from "@/lib/instagram";

function Instagram({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  );
}

// Shared with /instagram — see lib/instagram.ts for why this is a curated
// grid rather than a live feed, and what it would take to make it real.
const POSTS = CURATED_POSTS.map((p) => p.src);

export function InstagramSection() {
  const s = useSettings();
  // Derived from the admin-set profile URL rather than hardcoded — the brand
  // handle is DB-driven like every other brand string.
  const handle = instagramHandle(s.instagram);

  return (
    <section className="container-px mx-auto max-w-7xl pb-20">
      <div className="text-center">
        <p className="text-xs uppercase tracking-widest gold-text">
          Follow along
        </p>
        <h2 className="mt-1 font-serif text-3xl md:text-4xl">
          {handle}
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
          Tag us in your fits — we repost our favourites.
        </p>
      </div>

      <div className="mt-8 grid grid-cols-3 gap-2 sm:gap-3 md:grid-cols-6">
        {POSTS.map((src, i) => (
          <a
            key={src}
            href={s.instagram || "https://instagram.com"}
            target="_blank"
            rel="noreferrer"
            className="group relative block aspect-square overflow-hidden rounded-lg bg-muted"
            aria-label={`View post ${i + 1} on Instagram`}
          >
            <Image
              src={src}
              alt=""
              fill
              sizes="(max-width: 768px) 33vw, 16vw"
              className="object-cover transition-transform duration-700 group-hover:scale-110"
            />
            <span className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
              <Instagram className="h-6 w-6 text-white" />
            </span>
          </a>
        ))}
      </div>

      {s.instagram && (
        <div className="mt-6 text-center">
          <a
            href={s.instagram}
            target="_blank"
            rel="noreferrer"
            className="link-underline inline-flex items-center gap-2 text-sm"
          >
            <Instagram className="h-4 w-4" /> Follow us on Instagram
          </a>
        </div>
      )}
    </section>
  );
}
