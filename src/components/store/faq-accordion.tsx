"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { GlossaryText } from "@/components/store/info-tip";

export type FaqItem = { q: string; a: string };

export function FaqAccordion({ items }: { items: FaqItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="divide-y divide-border rounded-lg border border-border bg-card">
      {items.map((item, i) => {
        const open = openIndex === i;
        return (
          <div key={item.q}>
            <button
              type="button"
              onClick={() => setOpenIndex(open ? null : i)}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
              aria-expanded={open}
            >
              <span className="font-medium">{item.q}</span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                  open && "rotate-180 text-accent"
                )}
              />
            </button>
            <div
              // The answer stays in the DOM when collapsed (crawlers read it),
              // so `inert` is what keeps the info-tip buttons inside it out of
              // the tab order until the panel is actually open.
              inert={!open}
              className={cn(
                "grid transition-all duration-300 ease-out",
                open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
              )}
            >
              <div className="overflow-hidden">
                <p className="px-5 pb-4 text-sm leading-relaxed text-muted-foreground">
                  {/* Explains "Cash on Delivery", "prepaid", "business days" …
                      in place — the tip is portalled, so this panel's
                      overflow-hidden can't clip it. */}
                  <GlossaryText text={item.a} />
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
