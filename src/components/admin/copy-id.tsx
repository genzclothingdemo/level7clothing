"use client";

import { toast } from "sonner";
import { Copy } from "lucide-react";

/**
 * A record's ID, click-to-copy. IDs are long cuids that are painful to select by
 * hand, and they're what you paste into a support thread, a spreadsheet or a
 * database lookup. Used in Admin → Orders (per line item) and Admin → Products,
 * so an ID copied off an order can be matched against the catalogue.
 */
export function CopyableId({
  id,
  label = "Product ID",
}: {
  id: string;
  label?: string;
}) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(id);
      toast.success(`${label} copied`);
    } catch {
      // Clipboard access needs a secure context — fall back to manual copy.
      toast.error("Couldn't copy — select the ID and copy it manually");
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={`Copy ${label.toLowerCase()}`}
      className="inline-flex max-w-full cursor-pointer items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:text-foreground"
    >
      <Copy className="h-2.5 w-2.5 shrink-0" />
      <span className="truncate">{id}</span>
    </button>
  );
}
