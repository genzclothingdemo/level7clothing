"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ShoppingBag, User, Search, Home, Store } from "lucide-react";
import { useCart } from "@/context/cart";
import { useSettings } from "@/context/settings";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { SearchBox } from "@/components/store/search-box";
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
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const keyboardOpen = useKeyboardOpen();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      {/* ── Top header (all sizes) ── */}
      <header
        className={cn(
          "sticky top-0 z-40 transition-all duration-500",
          scrolled
            ? "border-b border-border bg-background/80 shadow-lg shadow-primary/5 backdrop-blur-md"
            : "border-b border-transparent bg-background/0"
        )}
      >
        <nav className="container-px mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 md:h-20">
          {/* Logo */}
          <Link href="/" className="flex shrink-0 items-center gap-2">
            {settings.logoUrl ? (
              <Image
                src={settings.logoUrl}
                alt={settings.brandName}
                width={130}
                height={36}
                className="h-7 w-auto object-contain md:h-8"
              />
            ) : (
              <span className="font-serif text-xl tracking-tight md:text-2xl">
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

          {/* Right: action icons */}
          <div className="flex items-center gap-1.5 md:gap-2">
            {/* Desktop search icon */}
            <div className="hidden md:block">
              <SearchBox variant="icon" />
            </div>
            {/* Mobile: quick link to search / shop */}
            <Link
              href="/shop"
              className="grid h-10 w-10 place-items-center rounded-full border border-border transition-all duration-300 hover:scale-105 hover:border-primary/40 hover:bg-primary/5 active:scale-95 cursor-pointer md:hidden"
              aria-label="Search"
            >
              <Search className="h-[18px] w-[18px]" />
            </Link>
            <ThemeToggle />
            {/* Account — desktop only (mobile uses bottom bar) */}
            <Link
              href="/account"
              className="relative hidden md:grid h-10 w-10 place-items-center rounded-full border border-border transition-all duration-300 hover:scale-105 hover:border-primary/40 hover:bg-primary/5 active:scale-95 cursor-pointer"
              aria-label={account ? "My account" : "Log in"}
              title={account ? `Hi, ${account.name.split(" ")[0]}` : "Log in"}
            >
              <User className="h-[18px] w-[18px]" />
              {account && (
                <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-success ring-2 ring-background" />
              )}
            </Link>
            <button
              onClick={() => setOpen(true)}
              className="relative grid h-10 w-10 place-items-center rounded-full border border-border transition-all duration-300 hover:scale-105 hover:border-primary/40 hover:bg-primary/5 active:scale-95 cursor-pointer"
              aria-label="Open cart"
            >
              <ShoppingBag className="h-[18px] w-[18px]" />
              {count > 0 && (
                // key={count} remounts the badge when the count changes, so it
                // pops every time something is added to the cart.
                <span
                  key={count}
                  className="animate-pop absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] font-medium text-primary-foreground shadow-md shadow-primary/30"
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
          "pb-safe" // respects iPhone home-indicator
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
          {/* Cart tab */}
          <li className="flex-1">
            <button
              onClick={() => setOpen(true)}
              className={cn(
                "relative flex w-full flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-medium tracking-wide transition-colors",
                "text-muted-foreground"
              )}
              aria-label="Open cart"
            >
              <span className="relative">
                <ShoppingBag className="h-5 w-5" strokeWidth={1.6} />
                {count > 0 && (
                  <span
                    key={count}
                    className="animate-pop absolute -right-2 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-0.5 text-[9px] font-semibold text-primary-foreground"
                  >
                    {count}
                  </span>
                )}
              </span>
              Cart
            </button>
          </li>
          {/* Account tab */}
          <li className="flex-1">
            <Link
              href="/account"
              className={cn(
                "relative flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-medium tracking-wide transition-colors",
                pathname.startsWith("/account") ? "text-accent" : "text-muted-foreground"
              )}
              aria-label={account ? "My account" : "Log in"}
            >
              <span className="relative">
                <User className="h-5 w-5" strokeWidth={1.6} />
                {account && (
                  <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-success ring-1 ring-background" />
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
