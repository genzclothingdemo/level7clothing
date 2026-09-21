"use client";

import { useState } from "react";
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
  user: { name: string; email: string; phone: string | null };
  orders: AccountOrder[];
  reviews: ReviewItem[];
  /** Saved `Address` rows, default first. The only address data on this page. */
  addresses: SavedAddress[];
  /** From `?tab=` so "Change address" and other links can deep-link a tab. */
  initialTab?: AccountTab;
}) {
  const [activeTab, setActiveTab] = useState<AccountTab>(initialTab);

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

  return (
    <div className="mt-6 space-y-6">
      {/* ── Tab bar ── */}
      <div
        role="tablist"
        aria-label="Account sections"
        className="no-scrollbar flex gap-2 overflow-x-auto border-b border-border pb-1"
      >
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = activeTab === id;
          const count = counts[id];
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(id)}
              className={cn(
                "flex min-h-11 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg px-4 text-sm font-medium transition-colors",
                active
                  ? "bg-accent/15 text-accent"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
              {count !== null && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {count}
                </span>
              )}
            </button>
          );
        })}

        <Link
          href="/about"
          className="flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Info className="h-4 w-4" />
          About Us
        </Link>
        <Link
          href="/contact"
          className="flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Phone className="h-4 w-4" />
          Contact Us
        </Link>
      </div>

      {/* ── Active panel ── */}
      <div className="pt-2">
        {activeTab === "profile" && (
          <div className="max-w-2xl">
            <h2 className="mb-4 font-serif text-2xl">Profile</h2>
            <AccountProfile
              name={user.name}
              email={user.email}
              phone={user.phone}
              defaultAddress={defaultAddress}
              addressCount={addresses.length}
              onManageAddresses={() => setActiveTab("addresses")}
            />
          </div>
        )}

        {activeTab === "orders" && (
          <div>
            <h2 className="mb-4 font-serif text-2xl">
              My Orders ({orders.length})
            </h2>
            <AccountOrders orders={orders} />
          </div>
        )}

        {activeTab === "addresses" && (
          <div className="max-w-3xl">
            <h2 className="mb-4 font-serif text-2xl">
              Saved addresses ({addresses.length})
            </h2>
            <AddressBook addresses={addresses} />
          </div>
        )}

        {activeTab === "portfolio" && (
          <div>
            <h2 className="mb-4 font-serif text-2xl">
              Portfolio & Customer Reviews
            </h2>
            <PortfolioSection reviews={reviews} />
          </div>
        )}
      </div>
    </div>
  );
}
