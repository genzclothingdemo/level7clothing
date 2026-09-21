"use client";

/**
 * Edit / pause / delete for one coupon row.
 *
 * Pause is here rather than buried in the editor because it is the action an
 * admin actually needs in a hurry — a code leaking on a deal site is a
 * one-tap problem. Delete asks twice as hard when the code has been redeemed,
 * since `CouponRedemption` cascades and the record of who used it goes with it.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pause, Pencil, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteCoupon, setCouponActive } from "@/components/admin/coupon-actions";

const ICON_BUTTON =
  "inline-grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-40 sm:h-9 sm:w-9";

export function CouponRowActions({
  id,
  code,
  isActive,
  usedCount,
}: {
  id: string;
  code: string;
  isActive: boolean;
  usedCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [deleting, setDeleting] = useState(false);

  function togglePaused() {
    startTransition(async () => {
      const res = await setCouponActive(id, !isActive);
      if (res.success) {
        toast.success(isActive ? `${code} paused` : `${code} is live`);
        router.refresh();
      } else {
        toast.error(res.error ?? "Couldn't update the coupon.");
      }
    });
  }

  async function remove() {
    const warning =
      usedCount > 0
        ? `${code} has been used ${usedCount} time${usedCount === 1 ? "" : "s"}. ` +
          "Deleting it also deletes the record of who redeemed it. Pause it instead?\n\n" +
          "Press OK only if you really want it gone."
        : `Delete ${code}?`;
    if (!confirm(warning)) return;

    setDeleting(true);
    const res = await deleteCoupon(id);
    setDeleting(false);
    if (res.success) {
      toast.success(`${code} deleted`);
      router.refresh();
    } else {
      toast.error(res.error ?? "Couldn't delete the coupon.");
    }
  }

  return (
    <div className="flex items-center justify-end gap-0.5">
      <Link
        href={`/admin/coupons/${id}/edit`}
        aria-label={`Edit ${code}`}
        title="Edit"
        className={`${ICON_BUTTON} hover:bg-muted hover:text-foreground`}
      >
        <Pencil className="h-4 w-4" />
      </Link>

      <button
        type="button"
        onClick={togglePaused}
        disabled={pending}
        aria-label={isActive ? `Pause ${code}` : `Resume ${code}`}
        title={isActive ? "Pause" : "Resume"}
        className={`${ICON_BUTTON} hover:bg-muted hover:text-foreground`}
      >
        {isActive ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>

      <button
        type="button"
        onClick={remove}
        disabled={deleting}
        aria-label={`Delete ${code}`}
        title="Delete"
        className={`${ICON_BUTTON} hover:bg-danger/10 hover:text-danger`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
