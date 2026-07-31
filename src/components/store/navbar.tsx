"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  ShoppingBag,
  User,
  Search,
  Home,
  Store,
  Menu,
  X,
  ChevronDown,
  MoreHorizontal,
  Heart,
} from "lucide-react";
import { useCart } from "@/context/cart";
import { useSettings } from "@/context/settings";
import { useWishlist } from "@/context/wishlist";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { SearchBox } from "@/components/store/search-box";
import { useKeyboardOpen } from "@/hooks/use-keyboard-open";
import { cn } from "@/lib/utils";

const cat = (name: string) => `/shop?category=${encodeURIComponent(name)}`;

// Primary desktop links
const desktopLinks = [
  { href: "/", label: "Home" },
  { href: "/shop", label: "Shop" },
];

// T-Shirts covers the two real Level7 tee collections
const teeLinks = [
  { href: cat("Minimalistic Oversized T-shirts"), label: "Minimalistic Oversized T-shirts" },
  { href: cat("Premium Oversized T-shirts"), label: "Premium Oversized T-shirts" },
];

const hoodieHref = cat("Oversized Drop-Shoulder Hoodies");

const companyLinks = [
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

// Secondary pages, tucked behind the "More" (•••) menu
const moreLinks = [
  { href: "/track-order", label: "Track order" },
  { href: "/faq", label: "FAQ" },
  { href: "/shipping-returns", label: "Shipping & returns" },
  { href: "/privacy-policy", label: "Privacy policy" },
  { href: "/terms", label: "Terms & conditions" },
];

// Mobile bottom bar: only core 4 tabs
const mobileLinks = [
  { href: "/", label: "Home", Icon: Home },
  { href: "/shop", label: "Shop", Icon: Store },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href.split("?")[0]) && href.startsWith(pathname.split("?")[0]);
}

function useOutsideClick<T extends HTMLElement>(onOutside: () => void) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onOutside]);
  return ref;
}

function NavDropdown({
  label,
  icon,
  items,
  align = "left",
}: {
  label: React.ReactNode;
  icon?: React.ReactNode;
  items: { href: string; label: string }[];
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClick<HTMLDivElement>(() => setOpen(false));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "link-underline flex items-center gap-1 text-sm tracking-wide transition-colors hover:text-accent",
          open ? "text-accent" : "text-foreground"
        )}
        aria-expanded={open}
      >
        {label}
        {icon ?? <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />}
      </button>
      {open && (
        <div
          className={cn(
            "absolute top-full z-50 mt-3 min-w-[240px] rounded-lg border border-border bg-card p-2 shadow-xl",
            align === "right" ? "right-0" : "left-0"
          )}
        >
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2.5 text-sm text-foreground/90 hover:bg-muted hover:text-accent"
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function Navbar({ account }: { account?: { name: string } | null }) {
  const settings = useSettings();
  const { count, setOpen } = useCart();
  const { count: wishlistCount } = useWishlist();
  const pathname = usePathname();
  const keyboardOpen = useKeyboardOpen();
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [prevPathname, setPrevPathname] = useState(pathname);

  // Close the mobile drawer whenever the route changes (adjust state during
  // render rather than in an effect, per React's recommended pattern).
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setMobileMenuOpen(false);
  }

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Lock body scroll while the mobile drawer is open
  useEffect(() => {
    document.body.style.overflow = mobileMenuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileMenuOpen]);

  return (
    <>
      {/* ── Top header (all sizes) ── */}
      <header
        className={cn(
          "sticky top-0 z-40 transition-colors duration-300",
          scrolled
            ? "border-b border-border bg-background/80 backdrop-blur-md"
            : "border-b border-transparent bg-background/0"
        )}
      >
        <nav className="container-px mx-auto flex h-14 max-w-7xl items-center justify-between gap-2 md:h-20 md:gap-3">
          {/* Mobile: hamburger */}
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="grid h-10 w-10 place-items-center rounded-full border border-border hover:bg-muted md:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-[18px] w-[18px]" />
          </button>

          {/* Logo */}
          {/* min-w-0 (not shrink-0): the brand is the only flexible item in this
              row, so pinning it at content width pushed the header past the
              viewport on 320px phones. Let it truncate instead. */}
          <Link href="/" className="flex min-w-0 items-center gap-2">
            {settings.logoUrl ? (
              <Image
                src={settings.logoUrl}
                alt={settings.brandName}
                width={130}
                height={36}
                className="h-7 w-auto max-w-[42vw] object-contain md:h-8 md:max-w-none"
              />
            ) : (
              <span className="truncate font-serif text-lg tracking-tight sm:text-xl md:text-2xl">
                {settings.brandName}
              </span>
            )}
          </Link>

          {/* Center: desktop links only */}
          <ul className="hidden items-center gap-6 md:flex lg:gap-7">
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
            {companyLinks.map(({ href, label }) => {
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
            <li>
              <NavDropdown
                label=""
                icon={<MoreHorizontal className="h-4 w-4" />}
                items={moreLinks}
                align="right"
              />
            </li>
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
              className="grid h-10 w-10 place-items-center rounded-full border border-border hover:bg-muted cursor-pointer md:hidden"
              aria-label="Search"
            >
              <Search className="h-[18px] w-[18px]" />
            </Link>
            <ThemeToggle />
            {/* Wishlist — desktop only (mobile uses the drawer) */}
            <Link
              href="/wishlist"
              className="relative hidden md:grid h-10 w-10 place-items-center rounded-full border border-border hover:bg-muted cursor-pointer"
              aria-label="My wishlist"
              title="My wishlist"
            >
              <Heart className="h-[18px] w-[18px]" />
              {wishlistCount > 0 && (
                <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] font-medium text-accent-foreground">
                  {wishlistCount}
                </span>
              )}
            </Link>
            {/* Account — desktop only (mobile uses bottom bar) */}
            <Link
              href="/account"
              className="relative hidden md:grid h-10 w-10 place-items-center rounded-full border border-border hover:bg-muted cursor-pointer"
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
              className="relative grid h-10 w-10 place-items-center rounded-full border border-border hover:bg-muted cursor-pointer"
              aria-label="Open cart"
            >
              <ShoppingBag className="h-[18px] w-[18px]" />
              {count > 0 && (
                <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] font-medium text-accent-foreground">
                  {count}
                </span>
              )}
            </button>
          </div>
        </nav>
      </header>

      {/* ── Mobile nav drawer ── */}
      <div
        className={cn(
          "fixed inset-0 z-[60] md:hidden",
          mobileMenuOpen ? "pointer-events-auto" : "pointer-events-none"
        )}
        aria-hidden={!mobileMenuOpen}
      >
        {/* Backdrop */}
        <div
          onClick={() => setMobileMenuOpen(false)}
          className={cn(
            "absolute inset-0 bg-black/50 transition-opacity duration-300",
            mobileMenuOpen ? "opacity-100" : "opacity-0"
          )}
        />
        {/* Panel */}
        <div
          className="absolute inset-y-0 left-0 flex w-[85%] max-w-sm flex-col overflow-y-auto bg-background shadow-2xl transition-transform duration-300 ease-out"
          style={{ transform: mobileMenuOpen ? "translateX(0)" : "translateX(-100%)" }}
        >
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <span className="font-serif text-xl">{settings.brandName}</span>
            <button
              onClick={() => setMobileMenuOpen(false)}
              className="grid h-9 w-9 place-items-center rounded-full border border-border hover:bg-muted"
              aria-label="Close menu"
            >
              <X className="h-[18px] w-[18px]" />
            </button>
          </div>

          <nav className="flex-1 px-3 py-4">
            <MobileNavGroup title="Shop">
              <MobileNavLink href="/shop">Shop all</MobileNavLink>
              {teeLinks.map((l) => (
                <MobileNavLink key={l.href} href={l.href}>
                  {l.label}
                </MobileNavLink>
              ))}
              <MobileNavLink href={hoodieHref}>
                Oversized Drop-Shoulder Hoodies
              </MobileNavLink>
            </MobileNavGroup>

            <MobileNavGroup title="Company">
              {companyLinks.map((l) => (
                <MobileNavLink key={l.href} href={l.href}>
                  {l.label}
                </MobileNavLink>
              ))}
            </MobileNavGroup>

            <MobileNavGroup title="Help">
              {moreLinks.map((l) => (
                <MobileNavLink key={l.href} href={l.href}>
                  {l.label}
                </MobileNavLink>
              ))}
            </MobileNavGroup>

            <MobileNavGroup title="Account">
              <MobileNavLink href="/wishlist">
                My wishlist{wishlistCount > 0 ? ` (${wishlistCount})` : ""}
              </MobileNavLink>
              <MobileNavLink href="/account">
                {account ? `Hi, ${account.name.split(" ")[0]}` : "Log in / Sign up"}
              </MobileNavLink>
            </MobileNavGroup>
          </nav>
        </div>
      </div>

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
                  <span className="absolute -right-2 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-0.5 text-[9px] font-semibold text-accent-foreground">
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
          {/* More tab (opens the drawer) */}
          <li className="flex-1">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="flex w-full flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-medium tracking-wide text-muted-foreground"
              aria-label="More"
            >
              <MoreHorizontal className="h-5 w-5" strokeWidth={1.6} />
              More
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}

function MobileNavGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <p className="px-3 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function MobileNavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="rounded-lg px-3 py-2.5 text-sm text-foreground/90 hover:bg-muted hover:text-accent"
    >
      {children}
    </Link>
  );
}
