"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * The two views of Admin → Inventory: **Stock** (what is on the shelf now) and
 * **Ledger** (every entry that put it there).
 *
 * Real routes, not `?tab=`, for the reasons the customer record gives: a view
 * is a link that can be pasted, Back steps between them, and each keeps its own
 * filters in its own URL — the ledger's product and date filters must not be
 * cleared by the stock list's search, or the other way round.
 *
 * A product's own page (`/admin/inventory/<id>`) lights **Stock**: it is the
 * detail of a row in that list, and its history is one tab away.
 *
 * The one client component in the header, because a layout cannot know which
 * of its children is rendering — "which tab is on" is read from the pathname.
 */

const chip =
  "inline-flex min-h-11 items-center rounded-lg border px-3 text-[11px] font-medium uppercase tracking-wider transition-colors sm:min-h-9 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const chipOn = "border-accent bg-accent/10 text-accent";
const chipOff = "border-border text-muted-foreground hover:bg-muted hover:text-foreground";

export function InventoryNav() {
  const pathname = usePathname();
  const onLedger = pathname.startsWith("/admin/inventory/ledger");

  const tabs = [
    { href: "/admin/inventory", label: "Stock", on: !onLedger },
    { href: "/admin/inventory/ledger", label: "Ledger", on: onLedger },
  ];

  return (
    <nav aria-label="Inventory views" className="flex gap-1 rounded-lg border border-border bg-card p-1.5">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.on ? "page" : undefined}
          className={cn(chip, t.on ? chipOn : chipOff)}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
