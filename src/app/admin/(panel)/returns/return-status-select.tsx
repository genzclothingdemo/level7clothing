"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setReturnStatus } from "./actions";
import { RETURN_STATUSES, RETURN_STATUS_LABEL } from "@/lib/returns";

const OPTIONS = RETURN_STATUSES;

export function ReturnStatusSelect({
  id,
  status,
}: {
  id: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <select
      value={status}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value;
        start(async () => {
          try {
            await setReturnStatus(id, next);
            toast.success(
              `Marked as ${RETURN_STATUS_LABEL[next as (typeof RETURN_STATUSES)[number]] ?? next}`,
            );
            router.refresh();
          } catch {
            toast.error("Could not update status");
          }
        });
      }}
      className="input h-9 py-1 text-xs disabled:opacity-50"
    >
      {OPTIONS.map((o) => (
        <option key={o} value={o}>
          {RETURN_STATUS_LABEL[o]}
        </option>
      ))}
    </select>
  );
}
