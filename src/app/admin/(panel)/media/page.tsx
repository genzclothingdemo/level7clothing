import { MediaLibrary } from "@/components/admin/media-library";

export const metadata = {
  title: "Media Library | Admin",
};

export default function MediaPage() {
  return (
    <div className="flex flex-col h-full bg-background">
      <div className="border-b border-border bg-card px-6 py-4 flex items-center justify-between shrink-0">
        <div>
          <h1 className="font-serif text-2xl">Media Library</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage and organize your digital assets</p>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <MediaLibrary />
      </div>
    </div>
  );
}
