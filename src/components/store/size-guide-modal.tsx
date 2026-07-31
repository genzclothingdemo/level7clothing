"use client";

import { useEffect, useState } from "react";
import { Ruler, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ChartKind = "tee" | "hoodie";

const CHARTS: Record<
  ChartKind,
  { rows: { size: string; chest: string; length: string; shoulder: string }[] }
> = {
  tee: {
    rows: [
      { size: "S", chest: "40", length: "27", shoulder: "20" },
      { size: "M", chest: "42", length: "28", shoulder: "21" },
      { size: "L", chest: "44", length: "29", shoulder: "22" },
      { size: "XL", chest: "46", length: "30", shoulder: "23" },
      { size: "2XL", chest: "48", length: "31", shoulder: "24" },
    ],
  },
  hoodie: {
    rows: [
      { size: "S", chest: "42", length: "27", shoulder: "21" },
      { size: "M", chest: "44", length: "28", shoulder: "22" },
      { size: "L", chest: "46", length: "29", shoulder: "23" },
      { size: "XL", chest: "48", length: "30", shoulder: "24" },
      { size: "2XL", chest: "50", length: "31", shoulder: "25" },
    ],
  },
};

export function SizeGuideModal({ category }: { category: string }) {
  const [open, setOpen] = useState(false);
  const kind: ChartKind = /hoodie/i.test(category) ? "hoodie" : "tee";
  const { rows } = CHARTS[kind];

  // Escape to dismiss, and don't let the page scroll behind the sheet.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline cursor-pointer"
      >
        <Ruler className="h-3.5 w-3.5" /> Size guide
      </button>

      {/* Rendered only while open. Previously this stayed mounted and was
          "hidden" with translateY(100%), which from a vertically centred
          position doesn't clear the viewport — so the sheet sat visible on
          top of the page. */}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="size-guide-title"
          className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center"
        >
          <button
            type="button"
            aria-label="Close size guide"
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default bg-black/50 animate-[fadeIn_0.2s_ease-out_both]"
          />
          <div
            className={cn(
              "relative w-full max-w-lg border border-border bg-background p-6 shadow-2xl",
              "rounded-t-xl sm:rounded-xl",
              // Opacity-only entrance on purpose: the sheet's resting position
              // comes from layout alone (flush bottom on mobile, centred on
              // desktop), so it can never be left offset by an interrupted or
              // never-completed animation.
              "animate-[fadeIn_0.22s_ease-out_both]"
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <h3 id="size-guide-title" className="font-serif text-xl">
                Size guide
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border hover:bg-muted cursor-pointer"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              All measurements in inches. Our fits are intentionally oversized —
              size down for a slimmer look.
            </p>

            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Size</th>
                    <th className="py-2 pr-3 font-medium">Chest</th>
                    <th className="py-2 pr-3 font-medium">Length</th>
                    <th className="py-2 font-medium">Shoulder</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.size}>
                      <td className="py-2.5 pr-3 font-medium">{r.size}</td>
                      <td className="py-2.5 pr-3 text-muted-foreground">
                        {r.chest}&quot;
                      </td>
                      <td className="py-2.5 pr-3 text-muted-foreground">
                        {r.length}&quot;
                      </td>
                      <td className="py-2.5 text-muted-foreground">
                        {r.shoulder}&quot;
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-4 text-xs text-muted-foreground">
              Measured flat with the garment laid on a table. A ± 0.5&quot;
              variation is normal.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
