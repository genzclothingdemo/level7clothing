"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { User, Package, Star, Info, Phone, MapPin } from "lucide-react";
import { AccountProfile } from "@/components/store/account-profile";
import { AccountOrders, type AccountOrder } from "@/components/store/account-orders";
import { AddressBook } from "@/components/store/address-book";
import { PortfolioSection, type ReviewItem } from "@/components/store/portfolio-section";
import type { SavedAddress } from "@/app/actions/addresses";
import { cn } from "@/lib/utils";

export type AccountTab = "profile" | "orders" | "addresses" | "portfolio";

const TABS: { id: AccountTab; label: string; icon: typeof User }[] = [
  { id: "profile", label: "Profile", icon: User },
  { id: "orders", label: "My Orders", icon: Package },
  { id: "addresses", label: "Addresses", icon: MapPin },
  { id: "portfolio", label: "Portfolio", icon: Star },
];

export function AccountView({
  user,
  orders,
  reviews,
  addresses,
  initialTab = "profile",
}: {
  user: {
    name: string;
    email: string;
    phone: string | null;
    /** Whether each channel has been confirmed with a one-time code. */
    emailVerified: boolean;
    phoneVerified: boolean;
  };
  orders: AccountOrder[];
  reviews: ReviewItem[];
  /** Saved `Address` rows, default first. The only address data on this page. */
  addresses: SavedAddress[];
  /** From `?tab=` so "Change address" and other links can deep-link a tab. */
  initialTab?: AccountTab;
}) {
  const [activeTab, setActiveTab] = useState<AccountTab>(initialTab);
  // Ids have to be stable across server and client renders, and unique if this
  // ever mounts twice — `useId` is the only thing that gives both.
  const panelBase = useId();
  const tabRefs = useRef(new Map<AccountTab, HTMLButtonElement>());

  const counts: Record<AccountTab, number | null> = {
    profile: null,
    orders: orders.length,
    addresses: addresses.length,
    portfolio: reviews.length,
  };

  // The address book guarantees exactly one default whenever it is non-empty,
  // and the query sorts defaults first — but fall back to the first row rather
  // than assume, so a legacy account can never render an empty summary.
  const defaultAddress =
    addresses.find((a) => a.isDefault) ?? addresses[0] ?? null;

  /**
   * Left/right arrow keys move between tabs, as WAI-ARIA's tab pattern
   * requires. Without this a keyboard user has to Tab through every panel
   * control to reach the next section.
   */
  function onTabKey(e: React.KeyboardEvent) {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (delta === 0) return;
    e.preventDefault();
    const index = TABS.findIndex((t) => t.id === activeTab);
    const next = TABS[(index + delta + TABS.length) % TABS.length];
    setActiveTab(next.id);
    tabRefs.current.get(next.id)?.focus();
  }

  return (
    <div className="mt-5 sm:mt-6">
      {/*
        One horizontally scrolling row, two groups.

        `role="tablist"` covers ONLY the four real tabs. About Us and Contact Us
        are ordinary links to other pages — inside the tablist they claimed to
        be tabs that control panels here, which is a lie to a screen reader and
        breaks arrow-key navigation. They keep their place in the row; they
        just sit outside the list, behind a divider that says so visually too.
      */}
      <div className="no-scrollbar flex items-center gap-1 overflow-x-auto border-b border-border pb-1">
        <div role="tablist" aria-label="Account sections" className="flex gap-1">
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = activeTab === id;
            const count = counts[id];
            return (
              <button
                key={id}
                ref={(el) => {
                  if (el) tabRefs.current.set(id, el);
                  else tabRefs.current.delete(id);
                }}
                type="button"
                role="tab"
                id={`${panelBase}-tab-${id}`}
                aria-selected={active}
                aria-controls={`${panelBase}-panel-${id}`}
                // Roving tabindex: the tablist is one stop, then arrows move
                // within it.
                tabIndex={active ? 0 : -1}
                onKeyDown={onTabKey}
                onClick={() => setActiveTab(id)}
                className={cn(
                  "flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors sm:px-4",
                  active
                    ? "bg-accent/15 text-accent"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {label}
                {count !== null && (
                  <span
                    className={cn(
                      "rounded-md px-1.5 py-0.5 text-[11px] tabular-nums",
                      active
                        ? "bg-accent/20 text-accent"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <span
          aria-hidden="true"
          className="mx-1 h-5 w-px shrink-0 self-center bg-border"
        />

        <Link
          href="/about"
          className="flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:px-4"
        >
          <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
          About Us
        </Link>
        <Link
          href="/contact"
          className="flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:px-4"
        >
          <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
          Contact Us
        </Link>
      </div>

      {/* ── Active panel ──
          Each panel is labelled by its own tab, so the visible `<h2>` that used
          to repeat the tab's word ("Profile" under Profile, "My Orders (3)"
          under a tab that already shows the count) is gone. On a 320px screen
          that heading and its margin were ~44px of the first viewport spent
          saying something the row above already said. */}
      <div
        role="tabpanel"
        id={`${panelBase}-panel-${activeTab}`}
        aria-labelledby={`${panelBase}-tab-${activeTab}`}
        tabIndex={0}
        className="mt-5 focus-visible:outline-none sm:mt-6"
      >
        {activeTab === "profile" && (
          <div className="max-w-2xl">
            <AccountProfile
              name={user.name}
              email={user.email}
              phone={user.phone}
              emailVerified={user.emailVerified}
              phoneVerified={user.phoneVerified}
              defaultAddress={defaultAddress}
              addressCount={addresses.length}
              onManageAddresses={() => setActiveTab("addresses")}
            />
          </div>
        )}

        {activeTab === "orders" && <AccountOrders orders={orders} />}

        {activeTab === "addresses" && (
          <div className="max-w-3xl">
            <AddressBook addresses={addresses} />
          </div>
        )}

        {activeTab === "portfolio" && <PortfolioSection reviews={reviews} />}
      </div>
    </div>
  );
}
