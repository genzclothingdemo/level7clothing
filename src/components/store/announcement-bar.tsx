"use client";

import { useSettings } from "@/context/settings";

export function AnnouncementBar() {
  const s = useSettings();
  if (!s.announcement) return null;
  return (
    <div className="bg-foreground text-background">
      <div className="container-px mx-auto max-w-7xl py-2.5 text-center text-[11px] font-medium uppercase tracking-[0.18em]">
        {s.announcement}
      </div>
    </div>
  );
}
