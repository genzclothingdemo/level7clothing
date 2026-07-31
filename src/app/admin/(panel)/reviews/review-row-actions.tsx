"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, EyeOff, Star, Trash } from "lucide-react";
import {
  deleteReview,
  setReviewApproved,
  setReviewFeatured,
} from "./actions";

export function ReviewRowActions({
  id,
  approved,
  featured,
}: {
  id: string;
  approved: boolean;
  featured: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function run(fn: () => Promise<unknown>, message: string) {
    start(async () => {
      try {
        await fn();
        toast.success(message);
        router.refresh();
      } catch {
        toast.error("Something went wrong");
      }
    });
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <button
        disabled={pending}
        onClick={() =>
          run(
            () => setReviewApproved(id, !approved),
            approved ? "Review hidden" : "Review approved"
          )
        }
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 cursor-pointer"
        title={approved ? "Hide from storefront" : "Approve & publish"}
      >
        {approved ? <EyeOff className="h-4 w-4" /> : <Check className="h-4 w-4" />}
      </button>
      <button
        disabled={pending}
        onClick={() =>
          run(
            () => setReviewFeatured(id, !featured),
            featured ? "Unfeatured" : "Featured"
          )
        }
        className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-muted disabled:opacity-50 cursor-pointer ${
          featured ? "text-accent" : "text-muted-foreground hover:text-foreground"
        }`}
        title={featured ? "Remove from featured" : "Show first (featured)"}
      >
        <Star className={`h-4 w-4 ${featured ? "fill-current" : ""}`} />
      </button>
      <button
        disabled={pending}
        onClick={() => {
          if (!confirm("Delete this review permanently?")) return;
          run(() => deleteReview(id), "Review deleted");
        }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-50 cursor-pointer"
        title="Delete review"
      >
        <Trash className="h-4 w-4" />
      </button>
    </div>
  );
}
