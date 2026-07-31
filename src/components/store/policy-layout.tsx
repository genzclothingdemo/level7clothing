import { Reveal } from "@/components/store/reveal";

export function PolicyLayout({
  eyebrow,
  title,
  updated,
  children,
}: {
  eyebrow: string;
  title: string;
  updated?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="container-px mx-auto max-w-3xl py-16">
      <Reveal>
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          {eyebrow}
        </p>
        <h1 className="mt-3 font-serif text-4xl leading-tight md:text-5xl">
          {title}
        </h1>
        {updated && (
          <p className="mt-3 text-sm text-muted-foreground">
            Last updated: {updated}
          </p>
        )}
      </Reveal>
      <Reveal delay={0.08}>
        <div className="prose-policy mt-10 space-y-8 leading-relaxed text-muted-foreground">
          {children}
        </div>
      </Reveal>
    </div>
  );
}

export function PolicySection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="font-serif text-2xl text-foreground">{title}</h2>
      <div className="mt-3 space-y-3 text-sm md:text-base">{children}</div>
    </section>
  );
}
