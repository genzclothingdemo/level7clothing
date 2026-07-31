"use client";

import Link from "next/link";
import { Mail, Phone, MapPin } from "lucide-react";
import { useSettings } from "@/context/settings";
import { NewsletterForm } from "@/components/store/newsletter-form";

function Instagram({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  );
}

function Facebook({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </svg>
  );
}

export function Footer() {
  const s = useSettings();
  const year = new Date().getFullYear();

  return (
    <footer className="mt-24 border-t border-border bg-card">
      {/* Newsletter band */}
      <div className="border-b border-border">
        <div className="container-px mx-auto flex max-w-7xl flex-col gap-5 py-10 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="font-serif text-2xl">Join the club</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Exclusive deals and early access to new products.
            </p>
          </div>
          <NewsletterForm className="w-full md:max-w-md" />
        </div>
      </div>

      <div className="container-px mx-auto max-w-7xl py-14">
        <div className="grid gap-10 md:grid-cols-5">
          <div className="md:col-span-2">
            <span className="font-serif text-2xl">{s.brandName}</span>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
              {s.tagline}
            </p>
            <div className="mt-5 flex gap-3">
              {s.instagram && (
                <a
                  href={s.instagram}
                  target="_blank"
                  rel="noreferrer"
                  className="grid h-10 w-10 place-items-center rounded-full border border-border hover:bg-muted"
                  aria-label="Instagram"
                >
                  <Instagram className="h-[18px] w-[18px]" />
                </a>
              )}
              {s.facebook && (
                <a
                  href={s.facebook}
                  target="_blank"
                  rel="noreferrer"
                  className="grid h-10 w-10 place-items-center rounded-full border border-border hover:bg-muted"
                  aria-label="Facebook"
                >
                  <Facebook className="h-[18px] w-[18px]" />
                </a>
              )}
            </div>
          </div>

          <div>
            <h4 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Explore
            </h4>
            <ul className="mt-4 space-y-2 text-sm">
              <li>
                <Link href="/shop" className="hover:text-accent">
                  Shop all
                </Link>
              </li>
              <li>
                <Link href="/about" className="hover:text-accent">
                  About
                </Link>
              </li>
              <li>
                <Link href="/contact" className="hover:text-accent">
                  Contact
                </Link>
              </li>
              <li>
                <Link href="/account" className="hover:text-accent">
                  My account &amp; orders
                </Link>
              </li>
              <li>
                <Link href="/wishlist" className="hover:text-accent">
                  My wishlist
                </Link>
              </li>
              <li>
                <Link href="/track-order" className="hover:text-accent">
                  Track order
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Help
            </h4>
            <ul className="mt-4 space-y-2 text-sm">
              <li>
                <Link href="/faq" className="hover:text-accent">
                  FAQ
                </Link>
              </li>
              <li>
                <Link href="/shipping-returns" className="hover:text-accent">
                  Shipping &amp; returns
                </Link>
              </li>
              <li>
                <Link href="/privacy-policy" className="hover:text-accent">
                  Privacy policy
                </Link>
              </li>
              <li>
                <Link href="/terms" className="hover:text-accent">
                  Terms &amp; conditions
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Get in touch
            </h4>
            <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
              <li className="flex items-center gap-2">
                <Mail className="h-4 w-4 shrink-0" />
                <a href={`mailto:${s.contactEmail}`} className="hover:text-accent">
                  {s.contactEmail}
                </a>
              </li>
              <li className="flex items-center gap-2">
                <Phone className="h-4 w-4 shrink-0" />
                <a
                  href={`tel:${s.contactPhone}`}
                  className="hover:text-accent"
                >
                  {s.contactPhone}
                </a>
              </li>
              {s.address && (
                <li className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{s.address}</span>
                </li>
              )}
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row">
          <p>
            © {year} {s.brandName}. All rights reserved.
          </p>
          <p>Premium quality · COD available</p>
        </div>
      </div>
    </footer>
  );
}
