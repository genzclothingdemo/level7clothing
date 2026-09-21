import { MediaLibrary } from "@/components/admin/media-library";

export const metadata = {
  title: "Media Library | Admin",
};

export default function MediaPage() {
  return (
    // `min-h-[70svh]` rather than `h-full` alone: the admin shell's <main> is a
    // flex child, so a percentage height collapses to nothing on short mobile
    // viewports and the grid ends up unscrollable. svh, never vh — see the
    // viewport-unit note in CLAUDE.md.
    <div className="flex h-full min-h-[70svh] flex-col bg-background">
      <div className="shrink-0 border-b border-border bg-card px-4 py-3 sm:px-6 sm:py-4">
        <h1 className="font-serif text-xl sm:text-2xl">Media Library</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Every photo the store can use. Filter, tag and tidy them here.
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <MediaLibrary />
      </div>
    </div>
  );
}
