"use client";

import { useState } from "react";
import Link from "next/link";
import { User, Package, Star, Info, Phone, MapPin } from "lucide-react";
import { AccountProfile } from "@/components/store/account-profile";
import { AccountOrders, type AccountOrder } from "@/components/store/account-orders";
import { AddressBook, type SavedAddress } from "@/components/store/address-book";
import { PortfolioSection, type ReviewItem } from "@/components/store/portfolio-section";
import { cn } from "@/lib/utils";

type Tab = "profile" | "orders" | "addresses" | "portfolio";

export function AccountView({
  user,
  orders,
  reviews,
  addresses,
}: {
  user: {
    name: string;
    email: string;
    phone: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    pincode?: string | null;
  };
  orders: AccountOrder[];
  reviews: ReviewItem[];
  addresses: SavedAddress[];
}) {
  const [activeTab, setActiveTab] = useState<Tab>("profile");

  return (
    <div className="mt-6 space-y-6">
      {/* ── Tab Bar & Navigation Buttons ── */}
      <div className="flex overflow-x-auto pb-1 no-scrollbar gap-2 border-b border-border">
        {/* Profile Tab */}
        <button
          type="button"
          onClick={() => setActiveTab("profile")}
          className={cn(
            "flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all whitespace-nowrap cursor-pointer",
            activeTab === "profile"
              ? "bg-accent/15 text-accent shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          <User className="h-4 w-4" />
          Profile
        </button>

        {/* My Orders Tab */}
        <button
          type="button"
          onClick={() => setActiveTab("orders")}
          className={cn(
            "flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all whitespace-nowrap cursor-pointer",
            activeTab === "orders"
              ? "bg-accent/15 text-accent shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          <Package className="h-4 w-4" />
          My Orders
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {orders.length}
          </span>
        </button>

        {/* Addresses Tab — the AddressBook component existed but was rendered
            nowhere, so saved addresses could not be managed at all. */}
        <button
          type="button"
          onClick={() => setActiveTab("addresses")}
          className={cn(
            "flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all whitespace-nowrap cursor-pointer",
            activeTab === "addresses"
              ? "bg-accent/15 text-accent shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          <MapPin className="h-4 w-4" />
          Addresses
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {addresses.length}
          </span>
        </button>

        {/* Portfolio Tab */}
        <button
          type="button"
          onClick={() => setActiveTab("portfolio")}
          className={cn(
            "flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all whitespace-nowrap cursor-pointer",
            activeTab === "portfolio"
              ? "bg-accent/15 text-accent shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          <Star className="h-4 w-4" />
          Portfolio
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {reviews.length}
          </span>
        </button>

        {/* About Us (Direct Link to Full Story) */}
        <Link
          href="/about"
          className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-all whitespace-nowrap"
        >
          <Info className="h-4 w-4" />
          About Us
        </Link>

        {/* Contact Us (Direct Link) */}
        <Link
          href="/contact"
          className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-all whitespace-nowrap"
        >
          <Phone className="h-4 w-4" />
          Contact Us
        </Link>
      </div>

      {/* ── Active Tab Content ── */}
      <div className="pt-2">
        {activeTab === "profile" && (
          <div className="max-w-xl">
            <h2 className="mb-4 font-serif text-2xl">Profile Details</h2>
            <AccountProfile
              name={user.name}
              email={user.email}
              phone={user.phone}
              address={user.address}
              city={user.city}
              state={user.state}
              pincode={user.pincode}
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
          <div className="max-w-2xl">
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
