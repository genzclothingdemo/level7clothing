"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSettings } from "@/context/settings";
import {
  LayoutDashboard,
  Package,
  Tag,
  ShoppingCart,
  Users,
  MessageSquare,
  Settings,
  ExternalLink,
  LogOut,
  Menu,
  X,
  Ticket,
  Images,
  Clapperboard,
  Star,
  PackageX,
  UserRound,
  Megaphone,
  Zap,
} from "lucide-react";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { logout } from "@/app/actions/auth";
import { cn } from "@/lib/utils";

/**
 * `match` exists for one entry. The analytics workspace is a single
 * destination spread over two route trees — Overview is the panel's index page
 * at `/admin`, the other five sections are `/admin/finance/*` — because
 * `/admin/page.tsx` cannot be moved. One nav item, one highlight rule covering
 * both, so the sidebar shows what the reader sees: one place, not two.
 */
const nav: {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
  match?: (pathname: string) => boolean;
}[] = [
  {
    href: "/admin",
    label: "Dashboard",
    icon: LayoutDashboard,
    match: (p) => p === "/admin" || p.startsWith("/admin/finance"),
  },
  { href: "/admin/products", label: "Products", icon: Package },
  { href: "/admin/categories", label: "Categories", icon: Tag },
  { href: "/admin/orders", label: "Orders", icon: ShoppingCart },
  // Customers sits next to Orders, not next to "Interested customers": it is
  // the master record a person resolves to, and an order is the usual way in.
  { href: "/admin/customers", label: "Customers", icon: UserRound },
  { href: "/admin/returns", label: "Returns", icon: PackageX },
  { href: "/admin/reviews", label: "Reviews", icon: Star },
  { href: "/admin/coupons", label: "Coupons", icon: Ticket },
  // Next to Coupons: both are "things that change what the shopper is
  // offered". A coupon waits to be typed in, a promotion goes looking.
  { href: "/admin/promotions", label: "Promotions", icon: Megaphone },
  // Next to the Media Library: both are "the pictures side of the store". The
  // library is every photo we hold; the portfolio is the ones we chose to show.
  { href: "/admin/portfolio", label: "Portfolio", icon: Clapperboard },
  { href: "/admin/media", label: "Media Library", icon: Images },
  { href: "/admin/leads", label: "Interested customers", icon: Users },
  { href: "/admin/messages", label: "Inquiries", icon: MessageSquare },
  // Last before Settings, because it is the screen you open to ask "what is
  // this store doing without me?" — and half of that answer lives in Settings,
  // which it links to rather than duplicating.
  { href: "/admin/automation", label: "Automation", icon: Zap },
  { href: "/admin/settings", label: "Branding & settings", icon: Settings },
];

export function AdminShell({
  email,
  children,
}: {
  email: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { brandName } = useSettings();

  const SidebarContent = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-6 py-5">
        <span className="font-serif text-2xl">{brandName}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          Admin
        </span>
      </div>
      <nav className="flex-1 space-y-1 px-3">
        {nav.map((item) => {
          const active = item.match
            ? item.match(pathname)
            : item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
                active
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="h-[18px] w-[18px]" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="space-y-1 border-t border-border p-3">
        <Link
          href="/"
          target="_blank"
          className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ExternalLink className="h-[18px] w-[18px]" /> View website
        </Link>
        <form action={logout}>
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-danger cursor-pointer"
          >
            <LogOut className="h-[18px] w-[18px]" /> Log out
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-border bg-card lg:block">
        <div className="sticky top-0 h-screen">{SidebarContent}</div>
      </aside>

      {/* Mobile sidebar */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 lg:hidden"
            onClick={() => setOpen(false)}
          />
          <aside className="fixed left-0 top-0 z-50 h-full w-64 border-r border-border bg-card lg:hidden">
            <button
              onClick={() => setOpen(false)}
              className="absolute right-3 top-4 grid h-9 w-9 place-items-center rounded-lg hover:bg-muted"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
            {SidebarContent}
          </aside>
        </>
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 56px, not 64px. This strip carries a hamburger, the signed-in
            address and the theme toggle — it is chrome, and it was spending
            more height than several of the panels underneath it. It is sticky,
            so every pixel here is taken from every screen permanently. */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur-md md:px-6">
          <button
            onClick={() => setOpen(true)}
            className="grid h-10 w-10 place-items-center rounded-lg hover:bg-muted lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {email}
            </span>
            <ThemeToggle />
          </div>
        </header>
        {/* 24px, not 32px, and no max-width: the owner's note was that the
            admin wastes space and reads zoomed. 32px on each side of a
            content column that already sits behind a 256px sidebar is a lot
            of nothing on a laptop. */}
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
