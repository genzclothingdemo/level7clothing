"use client";

import { useState } from "react";
import { User, Package } from "lucide-react";
import { AccountProfile } from "@/components/store/account-profile";
import { AccountOrders, type AccountOrder } from "@/components/store/account-orders";
import { AddressBook, type SavedAddress } from "@/components/store/address-book";
import { cn } from "@/lib/utils";

type Tab = "profile" | "orders";

export function AccountView({
  user,
  orders,
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
  addresses: SavedAddress[];
}) {
  const [activeTab, setActiveTab] = useState<Tab>("profile");

  return (
    <div className="mt-6 space-y-6">
      {/* ── Tab Bar ── */}
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
      </div>

      {/* ── Active Tab Content ── */}
      <div className="pt-2">
        {activeTab === "profile" && (
          <div className="space-y-10">
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
            <AddressBook addresses={addresses} />
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
      </div>
    </div>
  );
}
