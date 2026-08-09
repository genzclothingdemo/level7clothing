"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, EyeOff, Loader2, Pin, PinOff, Trash2, StickyNote } from "lucide-react";
import {
  deleteReview,
  setReviewApproved,
  setReviewFeatured,
  setReviewNote,
} from "@/app/actions/reviews";

/**
 * Moderation controls for one review: publish/hide, pin to the top of the
 * product's list, a private note, and delete.
 *
 * Delete asks for a second click rather than opening a dialog — it is the one
 * irreversible action here and a stray tap on a phone shouldn't destroy a
 * customer's words.
 */
export function ReviewActions({
  id,
  approved,
  featured,
  note,
}: {
  id: string;
  approved: boolean;
  featured: boolean;
  note: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [draft, setDraft] = useState(note ?? "");

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    start(async () => {
      try {
        const res = await fn();
        if (res.ok) {
          toast.success(ok);
          router.refresh();
        } else {
          toast.error(res.error || "Could not update");
        }
      } catch {
        toast.error("Could not update — are you still signed in?");
      }
    });
  }

  const btn =
    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}

        {approved ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => setReviewApproved(id, false), "Hidden from the storefront")}
            className={`${btn} border-border text-muted-foreground hover:bg-muted`}
            title="Unpublish — also unpins it"
          >
            <EyeOff className="h-3.5 w-3.5" /> Hide
          </button>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => setReviewApproved(id, true), "Published")}
            className={`${btn} border-success/40 bg-success/10 text-success hover:bg-success/20`}
          >
            <Check className="h-3.5 w-3.5" /> Approve
          </button>
        )}

        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(
              () => setReviewFeatured(id, !featured),
              featured ? "Unpinned" : "Pinned to the top"
            )
          }
          className={`${btn} ${
            featured
              ? "border-accent/40 bg-accent/10 text-accent hover:bg-accent/20"
              : "border-border text-muted-foreground hover:bg-muted"
          }`}
          title={featured ? "Stop showing first" : "Show first on the product page"}
        >
          {featured ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          {featured ? "Unpin" : "Show first"}
        </button>

        <button
          type="button"
          onClick={() => setNoteOpen((v) => !v)}
          className={`${btn} ${
            note
              ? "border-accent/40 text-accent"
              : "border-border text-muted-foreground hover:bg-muted"
          }`}
          title="Private note — never shown to customers"
        >
          <StickyNote className="h-3.5 w-3.5" /> {note ? "Note" : "Add note"}
        </button>

        {confirmDelete ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => deleteReview(id), "Review deleted")}
              className={`${btn} border-danger/40 bg-danger/10 text-danger hover:bg-danger/20`}
            >
              <Trash2 className="h-3.5 w-3.5" /> Really delete
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className={`${btn} border-border text-muted-foreground hover:bg-muted`}
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirmDelete(true)}
            className={`${btn} border-border text-muted-foreground hover:bg-danger/10 hover:text-danger`}
            aria-label="Delete review"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {noteOpen && (
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Private note (e.g. replied on WhatsApp)"
            className="input h-9 text-xs"
          />
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(() => setReviewNote(id, draft), draft.trim() ? "Note saved" : "Note cleared")
            }
            className={`${btn} shrink-0 border-border hover:bg-muted`}
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}
