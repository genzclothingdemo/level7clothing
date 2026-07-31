"use client";

import { useState } from "react";
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

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline cursor-pointer"
      >
        <Ruler className="h-3.5 w-3.5" /> Size guide
      </button>

      <div
        className={cn(
          "fixed inset-0 z-[70] flex items-end justify-center sm:items-center",
          open ? "pointer-events-auto" : "pointer-events-none"
        )}
        aria-hidden={!open}
      >
        <div
          onClick={() => setOpen(false)}
          className={cn(
            "absolute inset-0 bg-black/50 transition-opacity duration-300",
            open ? "opacity-100" : "opacity-0"
          )}
        />
        <div
          className="relative w-full max-w-lg rounded-t-3xl border border-border bg-background p-6 shadow-2xl transition-transform duration-300 ease-out sm:rounded-3xl"
          style={{ transform: open ? "translateY(0)" : "translateY(100%)" }}
        >
          <div className="flex items-center justify-between">
            <h3 className="font-serif text-xl">Size guide</h3>
            <button
              onClick={() => setOpen(false)}
              className="grid h-8 w-8 place-items-center rounded-full border border-border hover:bg-muted"
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
                    <td className="py-2.5 pr-3 text-muted-foreground">{r.chest}&quot;</td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{r.length}&quot;</td>
                    <td className="py-2.5 text-muted-foreground">{r.shoulder}&quot;</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-xs text-muted-foreground">
            Measured flat, garment laid on a table. A ± 0.5&quot; variation is
            normal for handcrafted-scale printing runs.
          </p>
        </div>
      </div>
    </>
  );
}
