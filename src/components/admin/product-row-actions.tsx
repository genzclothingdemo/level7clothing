"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Trash2, Eye, EyeOff, Loader2, Copy } from "lucide-react";
import { deleteProduct, setProductActive } from "@/app/actions/admin";

export function ProductRowActions({
  id,
  isActive,
}: {
  id: string;
  isActive: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function toggle() {
    start(async () => {
      await setProductActive(id, !isActive);
      router.refresh();
    });
  }

  function remove() {
    start(async () => {
      const res = await deleteProduct(id);
      if (res.ok) {
        toast.success("Product deleted");
        router.refresh();
      } else {
        toast.error("Could not delete");
      }
      setConfirming(false);
    });
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <button
        onClick={toggle}
        disabled={pending}
        title={isActive ? "Hide from shop" : "Show in shop"}
        className="grid h-9 w-9 place-items-center rounded-lg hover:bg-muted"
      >
        {isActive ? (
          <Eye className="h-4 w-4" />
        ) : (
          <EyeOff className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {/* Fastest route to the next near-identical piece in a set: copy this
          one, change the name and photos, save. */}
      <Link
        href={`/admin/products/new?copyOf=${id}`}
        title="Duplicate — opens a pre-filled copy"
        className="grid h-9 w-9 place-items-center rounded-lg hover:bg-muted"
      >
        <Copy className="h-4 w-4" />
      </Link>
      <Link
        href={`/admin/products/${id}/edit`}
        title="Edit"
        className="grid h-9 w-9 place-items-center rounded-lg hover:bg-muted"
      >
        <Pencil className="h-4 w-4" />
      </Link>
      {confirming ? (
        <span className="flex items-center gap-1">
          <button
            onClick={remove}
            disabled={pending}
            className="rounded-lg bg-danger px-2 py-1.5 text-xs text-white"
          >
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Delete"}
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="rounded-lg px-2 py-1.5 text-xs hover:bg-muted"
          >
            No
          </button>
        </span>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          title="Delete"
          className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-danger/10 hover:text-danger"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
