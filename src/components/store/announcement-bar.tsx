"use client";

import { useSettings } from "@/context/settings";

export function AnnouncementBar() {
  const s = useSettings();
  if (!s.announcement) return null;
  return (
    <div className="relative overflow-hidden bg-foreground text-background">
      <div className="animate-aurora pointer-events-none absolute -left-10 top-0 h-16 w-40 rounded-full bg-accent/30 blur-2xl" />
      <div className="container-px relative mx-auto max-w-7xl py-2 text-center text-xs tracking-[0.15em]">
        ✦ {s.announcement} ✦
      </div>
    </div>
  );
}
