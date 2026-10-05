import Image from "next/image";
import { getSettings } from "@/lib/settings";
import { ButtonLink } from "@/components/ui/button";
import { Reveal } from "@/components/store/reveal";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "About",
  description:
    "HALFTONE is an independent streetwear label — premium oversized tees and heavyweight hoodies, made to layer and last.",
  alternates: { canonical: "/about" },
};

const ABOUT_HERO_IMAGE =
  "https://images.unsplash.com/photo-1483985988355-763728e1935b?w=1000&h=1250&q=80&fm=jpg&fit=crop";
const ABOUT_GRID_IMAGES = [
  "https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?w=1000&h=1250&q=80&fm=jpg&fit=crop",
  "https://images.unsplash.com/photo-1489987707025-afc232f7ea0f?w=1000&h=1250&q=80&fm=jpg&fit=crop",
  "https://images.unsplash.com/photo-1525507119028-ed4c629a60a3?w=1000&h=1250&q=80&fm=jpg&fit=crop",
  "https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=1000&h=1250&q=80&fm=jpg&fit=crop",
];

export default async function AboutPage() {
  const s = await getSettings();

  return (
    <div className="container-px mx-auto max-w-5xl py-16">
      <Reveal>
        <div className="text-center">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Our story
          </p>
          <h1 className="mt-3 font-serif text-4xl leading-tight md:text-5xl">
            {s.brandName}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            {s.tagline}
          </p>
        </div>
      </Reveal>

      <Reveal delay={0.1}>
        <div className="relative mt-12 aspect-[16/9] overflow-hidden rounded-lg bg-muted">
          <Image
            src={ABOUT_HERO_IMAGE}
            alt={s.brandName}
            fill
            sizes="100vw"
            className="object-cover"
            priority
          />
        </div>
      </Reveal>

      <div className="mt-14 grid gap-10 md:grid-cols-2">
        <Reveal>
          <div>
            <h2 className="font-serif text-3xl">Quality and design, always</h2>
            <p className="mt-4 leading-relaxed text-muted-foreground">
              {s.aboutText}
            </p>
            <p className="mt-4 leading-relaxed text-muted-foreground">
              Every piece is designed to be worn, not just owned — oversized
              fits, premium fabric and graphics built to last through every wash.
            </p>
          </div>
        </Reveal>
        <Reveal delay={0.08}>
          <div className="grid grid-cols-2 gap-4">
            {ABOUT_GRID_IMAGES.map((src) => (
              <div
                key={src}
                className="relative aspect-square overflow-hidden rounded-lg bg-muted"
              >
                <Image
                  src={src}
                  alt="Studio"
                  fill
                  sizes="25vw"
                  className="object-cover"
                />
              </div>
            ))}
          </div>
        </Reveal>
      </div>

      <div className="mt-16 grid gap-6 sm:grid-cols-3">
        {[
          { t: "Premium quality", d: "Heavyweight fabric, oversized fits, built to last." },
          { t: "Made to order", d: "Custom prints, sizes and colours on request." },
          { t: "Loved across India", d: "Carefully packed and shipped nationwide." },
        ].map((v, i) => (
          <Reveal key={v.t} delay={i * 0.06}>
            <div className="rounded-lg border border-border bg-card p-6 text-center">
              <h3 className="font-serif text-xl gold-text">{v.t}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{v.d}</p>
            </div>
          </Reveal>
        ))}
      </div>

      <div className="mt-16 text-center">
        <ButtonLink href="/shop" size="lg">
          Explore the collection
        </ButtonLink>
      </div>
    </div>
  );
}
