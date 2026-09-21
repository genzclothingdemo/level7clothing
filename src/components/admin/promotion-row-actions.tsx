"use client";

/**
 * Edit / pause / delete for one promotion row.
 *
 * Pause is here rather than only inside the editor because it is the action an
 * admin needs in a hurry: a promotion is the most visible thing on the store,
 * and "take it down now" should be one tap from the list. Pausing the one that
 * is currently showing hands the storefront to the next promotion in priority
 * order, so the confirm says so rather than letting that be a surprise.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pause, Pencil, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deletePromotion, setPromotionActive } from "@/app/actions/promotions";

const ICON_BUTTON =
  "inline-grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-40 sm:h-9 sm:w-9";

export function PromotionRowActions({
  id,
  title,
  isActive,
  /** True when this is the promotion currently on the storefront. */
  showing,
}: {
  id: string;
  title: string;
  isActive: boolean;
  showing: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [deleting, setDeleting] = useState(false);

  function togglePaused() {
    if (
      isActive &&
      showing &&
      !confirm(
        `"${title}" is on the storefront right now.\n\n` +
          "Pausing it takes it down immediately. If another promotion is " +
          "scheduled and eligible, that one takes over."
      )
    ) {
      return;
    }

    startTransition(async () => {
      const res = await setPromotionActive(id, !isActive);
      if (res.success) {
        toast.success(isActive ? "Promotion paused" : "Promotion switched on");
        router.refresh();
      } else {
        toast.error(res.error ?? "Couldn't update the promotion.");
      }
    });
  }

  async function remove() {
    const warning = showing
      ? `"${title}" is on the storefront right now. Deleting it takes it down ` +
        "for good — pause it instead if you might run it again.\n\n" +
        "Press OK only if you really want it gone."
      : `Delete "${title}"?`;
    if (!confirm(warning)) return;

    setDeleting(true);
    const res = await deletePromotion(id);
    setDeleting(false);
    if (res.success) {
      toast.success("Promotion deleted");
      router.refresh();
    } else {
      toast.error(res.error ?? "Couldn't delete the promotion.");
    }
  }

  return (
    <div className="flex items-center justify-end gap-0.5">
      <Link
        href={`/admin/promotions/${id}/edit`}
        aria-label={`Edit ${title}`}
        title="Edit"
        className={`${ICON_BUTTON} hover:bg-muted hover:text-foreground`}
      >
        <Pencil className="h-4 w-4" />
      </Link>

      <button
        type="button"
        onClick={togglePaused}
        disabled={pending}
        aria-label={isActive ? `Pause ${title}` : `Switch on ${title}`}
        title={isActive ? "Pause" : "Switch on"}
        className={`${ICON_BUTTON} hover:bg-muted hover:text-foreground`}
      >
        {isActive ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>

      <button
        type="button"
        onClick={remove}
        disabled={deleting}
        aria-label={`Delete ${title}`}
        title="Delete"
        className={`${ICON_BUTTON} hover:bg-danger/10 hover:text-danger`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
