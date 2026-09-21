import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { InstagramIcon } from "@/components/store/instagram-icon";
import { getSettings } from "@/lib/settings";
import { CURATED_POSTS, instagramHandle } from "@/lib/instagram";
import { ButtonLink } from "@/components/ui/button";
import { InfoTip } from "@/components/store/info-tip";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings();
  const handle = instagramHandle(s.instagram);
  const title = "Instagram";
  const description = `See ${s.brandName} out in the world — fits, drops and behind the scenes from ${handle}.`;

  return {
    title,
    description,
    alternates: { canonical: "/instagram" },
    openGraph: {
      title: `${title} · ${s.brandName}`,
      description,
      url: "/instagram",
      siteName: s.brandName,
      type: "website",
      locale: "en_IN",
    },
    twitter: { card: "summary_large_image", title: `${title} · ${s.brandName}`, description },
  };
}

export default async function InstagramPage() {
  const s = await getSettings();
  const handle = instagramHandle(s.instagram);
  const profileUrl = s.instagram || "https://instagram.com";

  return (
    <div className="container-px mx-auto max-w-7xl py-14">
      <header className="text-center">
        <p className="eyebrow">Follow along</p>
        <h1 className="mt-2 font-serif text-4xl leading-tight md:text-5xl">
          {handle}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
          Fits, drops and behind the scenes. Tag us in yours — we repost our
          favourites.
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <ButtonLink href={profileUrl} target="_blank" rel="noreferrer">
            <InstagramIcon className="h-4 w-4" aria-hidden="true" />
            Open Instagram
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </ButtonLink>
          <ButtonLink href="/shop" variant="outline">
            Shop the looks
          </ButtonLink>
        </div>

        <p className="mt-5 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          A curated selection, not a live feed
          <InfoTip term="Why this isn't a live feed">
            Pulling real posts needs an Instagram Graph API token tied to a
            Business account, which isn&rsquo;t connected yet. These are shots
            from the same shoots — tap through to Instagram for the latest.
          </InfoTip>
        </p>
      </header>

      <div className="mt-10 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
        {CURATED_POSTS.map((post) => (
          <Link
            key={post.src}
            href={profileUrl}
            target="_blank"
            rel="noreferrer"
            // Instagram's own grid is square — the one place the store's
            // portrait 4/5 product standard deliberately doesn't apply.
            className="group relative aspect-square overflow-hidden rounded-lg bg-muted ring-1 ring-border/60 transition-colors hover:ring-accent/40"
          >
            <Image
              src={post.src}
              alt={post.alt}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className="object-cover"
            />
            <span className="pointer-events-none absolute inset-0 grid place-items-center bg-foreground/0 text-background opacity-0 transition-opacity group-hover:bg-foreground/35 group-hover:opacity-100">
              <InstagramIcon className="h-6 w-6" aria-hidden="true" />
            </span>
          </Link>
        ))}
      </div>

      <div className="rule mt-14" />

      <section className="mt-10 text-center">
        <h2 className="font-serif text-2xl">Seen something you like?</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          Every piece in these shots is in the shop.
        </p>
        <ButtonLink href="/shop" className="mt-6">
          Browse the collection
        </ButtonLink>
      </section>
    </div>
  );
}
