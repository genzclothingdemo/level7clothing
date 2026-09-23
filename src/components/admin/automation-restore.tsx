"use client";

/**
 * "Restore the ones I ship with."
 *
 * Small, but it closes a real hole. The templates and rules the store ships
 * with used to be rows somebody had typed into the live database by hand: there
 * was no way to get them back, and a fresh database — a new environment, a
 * restored backup — started with an empty Automation screen and a store that
 * silently emailed nobody.
 *
 * The action behind it is additive. It creates only what is missing and never
 * touches wording, recipients or the on/off switch, so pressing it when you are
 * not sure costs nothing. That is why there is no confirmation dialog: there is
 * nothing to confirm.
 */

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { restoreSystemAutomation } from "@/app/actions/automation";

export function AutomationRestoreButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function restore() {
    startTransition(async () => {
      const res = await restoreSystemAutomation();
      if (res.success) {
        toast.success(res.summary ?? "Done.");
        router.refresh();
      } else {
        toast.error(res.error ?? "Couldn't restore the shipped rules.");
      }
    });
  }

  return (
    <button
      type="button"
      onClick={restore}
      disabled={pending}
      className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-[11px] font-medium uppercase tracking-widest transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
    >
      <RotateCcw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
      {pending ? "Checking…" : "Restore shipped rules"}
    </button>
  );
}
