"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setReturnStatus } from "./actions";

const OPTIONS = ["requested", "approved", "rejected", "completed"];

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
            toast.success(`Marked as ${next}`);
            router.refresh();
          } catch {
            toast.error("Could not update status");
          }
        });
      }}
      className="input h-9 py-1 text-xs capitalize disabled:opacity-50"
    >
      {OPTIONS.map((o) => (
        <option key={o} value={o} className="capitalize">
          {o}
        </option>
      ))}
    </select>
  );
}
