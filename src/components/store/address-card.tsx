"use client";

import { cn } from "@/lib/utils";
import type { SavedAddress } from "@/app/actions/addresses";
import { AddressLabelTag, formatAddressLine } from "./address-fields";

/**
 * How one saved address reads, everywhere it is shown — the address book, the
 * checkout picker and the profile summary all render this, so a customer sees
 * the same block of text in all three places and can tell at a glance that it
 * is the same address.
 *
 * Presentation only. Whatever owns the address (a list row, a radio label, a
 * summary box) supplies its own container and controls.
 */
export function AddressSummary({
  address,
  className,
  /** Hides the tag + Default chip when the container already says which one. */
  showTag = true,
}: {
  address: SavedAddress;
  className?: string;
  showTag?: boolean;
}) {
  return (
    <div className={cn("min-w-0 text-sm", className)}>
      {showTag && (
        <div className="flex flex-wrap items-center gap-2">
          <AddressLabelTag label={address.label} />
          {address.isDefault && (
            <span className="rounded-md bg-accent/15 px-2 py-1 text-[11px] font-medium uppercase tracking-widest text-accent">
              Default
            </span>
          )}
        </div>
      )}
      <p className={cn("font-medium", showTag && "mt-2")}>{address.fullName}</p>
      {/* `break-words` matters at 320px: a long unbroken street name or a
          pasted address with no spaces would otherwise push the card wider
          than the viewport. */}
      <p className="mt-0.5 break-words text-muted-foreground">
        {formatAddressLine(address)}
      </p>
      <p className="mt-0.5 text-muted-foreground">{address.phone}</p>
    </div>
  );
}
