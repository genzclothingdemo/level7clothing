"use client";

import { useState } from "react";
import Link from "next/link";
import { Edit, Trash } from "lucide-react";
import { deleteCoupon } from "./actions";

export function CouponRowActions({
  id,
  isActive,
}: {
  id: string;
  isActive: boolean;
}) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this coupon?")) return;
    setIsDeleting(true);
    await deleteCoupon(id);
    setIsDeleting(false);
  };

  return (
    <div className="flex items-center gap-2 justify-end">
      <Link 
        href={`/admin/coupons/${id}/edit`}
        className="inline-flex h-11 w-11 -m-1.5 sm:h-9 sm:w-9 sm:m-0 items-center justify-center rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        title="Edit coupon"
      >
        <Edit className="h-4 w-4" />
      </Link>
      <button
        onClick={handleDelete}
        disabled={isDeleting}
        className="inline-flex h-11 w-11 -m-1.5 sm:h-9 sm:w-9 sm:m-0 items-center justify-center rounded-md hover:bg-danger/10 text-muted-foreground hover:text-danger transition-colors cursor-pointer disabled:opacity-50"
        title="Delete coupon"
      >
        <Trash className="h-4 w-4" />
      </button>
    </div>
  );
}
