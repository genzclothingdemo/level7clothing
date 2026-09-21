import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center px-6 text-center">
      <p className="font-serif text-7xl gold-text">404</p>
      <h1 className="mt-4 font-serif text-3xl">Page not found</h1>
      <p className="mt-2 text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist or has moved.
      </p>
      <Link
        href="/"
        className="mt-8 inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm text-primary-foreground hover:opacity-90"
      >
        Back home
      </Link>
    </div>
  );
}
