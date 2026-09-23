"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ShoppingBag, User, Home, Store, Heart, LayoutGrid } from "lucide-react";
import { useWishlist } from "@/context/wishlist";
import { useCart } from "@/context/cart";
import { useSettings } from "@/context/settings";
import { ChatLauncherButton, useChatUnread } from "@/components/store/chat-widget";
import { useKeyboardOpen } from "@/hooks/use-keyboard-open";
import { cn } from "@/lib/utils";

// Desktop nav links (all pages)
const desktopLinks = [
  { href: "/", label: "Home" },
  { href: "/shop", label: "Shop" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

// Mobile bottom bar: only core 4 tabs
const mobileLinks = [
  { href: "/", label: "Home", Icon: Home },
  { href: "/shop", label: "Shop", Icon: Store },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function Navbar({ account }: { account?: { name: string } | null }) {
  const settings = useSettings();
  const { count, setOpen } = useCart();
  const { count: wishlistCount } = useWishlist();
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const keyboardOpen = useKeyboardOpen();

  /*
   * The store has replied and the shopper has not read it.
   *
   * The chat launcher already carries the count; the account entries carry a
   * plain dot, because Account is where someone goes when they are wondering
   * "has anything happened about my order" — and on a phone the bottom bar's
   * Account tab is often the only navigation on screen. It is the same number
   * from the same source (`useChatUnread`), so the two can never disagree, and
   * it clears when the chat panel is opened with the tab focused — the only
   * thing that marks a message read.
   *
   * Deliberately a dot and not a count: the count already exists two icons to
   * the left, and repeating it would state one fact twice.
   */
  const chatUnread = useChatUnread();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      {/* ── Top header (all sizes) ──
          `top-safe`, not `top-0`: a sticky element pins to the scrollport's
          top edge, which with `viewportFit: "cover"` is underneath the Dynamic
          Island. `top-safe` resolves to 0 in a browser tab. */}
      <header
        className={cn(
          // NOT `transition-all`: that also transitions `top`, and `top` is now
          // the safe-area inset. Rotating an iPhone changes that inset from
          // 59px to 0, and `transition-all` turned the correction into a
          // half-second slide of the whole header. Only the four properties
          // that actually change on scroll are animated.
          "sticky top-safe z-40 transition-[background-color,border-color,box-shadow,backdrop-filter] duration-500",
          scrolled
            ? "border-b border-border bg-background/80 shadow-lg shadow-primary/5 backdrop-blur-md"
            : "border-b border-transparent bg-background/0"
        )}
      >
        <nav className="container-px mx-auto flex h-14 max-w-7xl items-center justify-between gap-2 md:h-20">
          {/* Logo.
              `min-w-0` + `truncate`, not `shrink-0`: at 320px the brand name
              and the icon cluster together want more room than there is, and a
              logo that refuses to give any back is how a row overflows. */}
          <Link href="/" className="flex min-w-0 items-center gap-2">
            {settings.logoUrl ? (
              <Image
                src={settings.logoUrl}
                alt={settings.brandName}
                width={130}
                height={36}
                className="h-7 w-auto object-contain md:h-8"
              />
            ) : (
              // Measured, not guessed: "Level7 Clothing" is 140px at 20px, the
              // three icons are 132px and a 320px screen offers 280px of nav —
              // 140 + 8 + 132 lands exactly on 280 and the name loses its last
              // letters to the ellipsis. One step down to 18px costs 14px and
              // buys the slack back. Only below 360px; 375 and up keep 20px.
              <span className="truncate font-serif text-lg tracking-tight min-[360px]:text-xl md:text-2xl">
                {settings.brandName}
              </span>
            )}
          </Link>

          {/* Center: desktop links only */}
          <ul className="hidden md:flex items-center gap-8">
            {desktopLinks.map(({ href, label }) => {
              const active = isActive(pathname, href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    data-active={active}
                    className={cn(
                      "link-underline text-sm tracking-wide transition-colors hover:text-accent",
                      active ? "text-accent" : "text-foreground"
                    )}
                  >
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>

          {/*
            Right: action icons.

            Flush (`gap-0`), borderless and squared — see `.icon-btn` in
            globals.css for why. The gaps existed to keep the old badges, which
            hung OUTSIDE each circle, from colliding; the badges now sit inside
            the button box, so the gaps have nothing left to do and the row
            fits a 320px phone with room to spare.

            Install and notifications deliberately do NOT live here — they are
            in the utility strip above (announcement-bar.tsx). Five 44px
            targets plus a wordmark is 220px of icons against 280px of usable
            width at 320px, which is not a row, it is a queue.
          */}
          <div className="flex shrink-0 items-center gap-0 md:gap-0.5">
            {/*
              No search icon here, on either breakpoint.
              /shop carries a real search field with filters and sorting
              beside it, which is where searching actually happens; the icon
              was a second entry point to the same thing and the mobile one
              was only a link to /shop dressed up as a search control.
              Removing it gives the three icons that DO something — chat,
              wishlist, cart — room to breathe.
            */}
            {/*
              This slot held the light/dark toggle. It now opens the chat,
              which is what a shopper actually reaches for — the store stays
              on its light default (see `defaultTheme` in providers.tsx, with
              `enableSystem` off), so nothing here is left half-set.
            */}
            <ChatLauncherButton />

            {/* Wishlist. Saved items are per-account once signed in, so this
                badge is the same number the customer sees on any device. */}
            <Link
              href="/wishlist"
              className="icon-btn"
              aria-label={
                wishlistCount > 0
                  ? `Wishlist (${wishlistCount} saved)`
                  : "Wishlist"
              }
            >
              <Heart className="h-[18px] w-[18px]" />
              {wishlistCount > 0 && (
                <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-medium text-accent-foreground ring-2 ring-background">
                  {wishlistCount > 9 ? "9+" : wishlistCount}
                </span>
              )}
            </Link>

            {/* Account — desktop only (mobile uses bottom bar) */}
            <Link
              href="/account"
              className="icon-btn hidden md:grid"
              aria-label={
                chatUnread > 0
                  ? `${account ? "My account" : "Log in"} — the store has replied`
                  : account ? "My account" : "Log in"
              }
              title={account ? `Hi, ${account.name.split(" ")[0]}` : "Log in"}
            >
              <User className="h-[18px] w-[18px]" />
              {/* Violet wins over the green "signed in" dot when there is
                  something waiting: one dot, and it says the more urgent of
                  the two things. Being signed in is a standing state; a reply
                  is news. */}
              {(account || chatUnread > 0) && (
                <span
                  className={cn(
                    "absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-background",
                    chatUnread > 0 ? "bg-accent" : "bg-success"
                  )}
                />
              )}
            </Link>
            <button
              onClick={() => setOpen(true)}
              className="icon-btn"
              aria-label="Open cart"
            >
              <ShoppingBag className="h-[18px] w-[18px]" />
              {count > 0 && (
                // key={count} remounts the badge when the count changes, so it
                // pops every time something is added to the cart.
                <span
                  key={count}
                  className="animate-pop absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground ring-2 ring-background"
                >
                  {count}
                </span>
              )}
            </button>
          </div>
        </nav>
      </header>

      {/* ── Mobile bottom tab bar (hidden on md+, and while typing) ── */}
      <nav
        aria-label="Mobile navigation"
        hidden={keyboardOpen}
        className={cn(
          "fixed bottom-0 inset-x-0 z-50 md:hidden",
          "border-t border-border bg-background/95 backdrop-blur-xl",
          // Home indicator at the bottom, and the notch at whichever side it
          // lands on in landscape — without `px-safe` the first tab sits under
          // the camera housing on a rotated iPhone.
          "pb-safe px-safe"
        )}
      >
        <ul className="flex items-stretch">
          {mobileLinks.map(({ href, label, Icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href} className="flex-1">
                <Link
                  href={href}
                  className={cn(
                    "flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-medium tracking-wide transition-colors",
                    active ? "text-accent" : "text-muted-foreground"
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon
                    className={cn(
                      "h-5 w-5 transition-transform",
                      active && "scale-110"
                    )}
                    strokeWidth={active ? 2.2 : 1.6}
                  />
                  {label}
                </Link>
              </li>
            );
          })}
          {/*
            Portfolio tab, where Cart used to be. Cart already has a permanent
            slot in the top bar with its own count badge, so a second entry
            point down here spent a quarter of the phone's primary navigation
            on a duplicate.

            Points at /portfolio, not /instagram: the portfolio is a superset
            (reels, blog links, collaborations, bulk-order work) and Instagram
            is only one source feeding it. The old path still resolves via a
            redirect, but the active check has to match the path the page
            actually renders at or the tab never highlights.
          */}
          <li className="flex-1">
            <Link
              href="/portfolio"
              className={cn(
                "relative flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-medium tracking-wide transition-colors",
                pathname.startsWith("/portfolio")
                  ? "text-accent"
                  : "text-muted-foreground"
              )}
              aria-current={pathname.startsWith("/portfolio") ? "page" : undefined}
            >
              <LayoutGrid
                className="h-5 w-5"
                strokeWidth={pathname.startsWith("/portfolio") ? 2.2 : 1.6}
              />
              Portfolio
            </Link>
          </li>
          {/* Account tab */}
          <li className="flex-1">
            <Link
              href="/account"
              className={cn(
                "relative flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-medium tracking-wide transition-colors",
                pathname.startsWith("/account") ? "text-accent" : "text-muted-foreground"
              )}
              aria-label={
                chatUnread > 0
                  ? `${account ? "My account" : "Log in"} — the store has replied`
                  : account ? "My account" : "Log in"
              }
            >
              <span className="relative">
                <User className="h-5 w-5" strokeWidth={1.6} />
                {/* Same rule as the desktop header: news beats standing state,
                    so an unread reply repaints the green dot violet rather
                    than adding a second one to a 20px icon. */}
                {(account || chatUnread > 0) && (
                  <span
                    className={cn(
                      "absolute -right-1 -top-1 h-2 w-2 rounded-full ring-1 ring-background",
                      chatUnread > 0 ? "bg-accent" : "bg-success"
                    )}
                  />
                )}
              </span>
              {account ? "Account" : "Login"}
            </Link>
          </li>
        </ul>
      </nav>
    </>
  );
}
