"use client";

import { useState } from "react";
import Link from "next/link";
import { User, Package, Star, Info, Phone } from "lucide-react";
import { AccountProfile } from "@/components/store/account-profile";
import { AccountOrders, type AccountOrder } from "@/components/store/account-orders";
import { PortfolioSection, type ReviewItem } from "@/components/store/portfolio-section";
import { cn } from "@/lib/utils";

type Tab = "profile" | "orders" | "portfolio";

export function AccountView({
  user,
  orders,
  reviews,
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
