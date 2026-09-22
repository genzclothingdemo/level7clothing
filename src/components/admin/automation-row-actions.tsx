"use client";

/**
 * Edit / pause / delete for one automation rule.
 *
 * Pause is on the row rather than only inside the editor for the same reason it
 * is on a promotion row: it is the action wanted in a hurry. A rule that is
 * emailing the wrong people is emailing them *now*, and the fix should be one
 * tap from the list rather than four screens into a form.
 *
 * Delete warns about the job history specifically. `AutomationJob` cascades
 * from the rule, so removing a rule also removes the record that its emails
 * ever went out — which is the one thing here that cannot be undone and the one
 * thing nobody expects from "delete a rule".
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pause, Pencil, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  deleteAutomationRule,
  setAutomationRuleActive,
} from "@/app/actions/automation";

const ICON_BUTTON =
  "inline-grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-40 sm:h-9 sm:w-9";

export function AutomationRowActions({
  id,
  name,
  isActive,
  /** Queued jobs this rule owns — deleting it cancels them. */
  queued,
}: {
  id: string;
  name: string;
  isActive: boolean;
  queued: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [deleting, setDeleting] = useState(false);

  function togglePaused() {
    startTransition(async () => {
      const res = await setAutomationRuleActive(id, !isActive);
      if (res.success) {
        toast.success(isActive ? "Rule paused" : "Rule switched on");
        router.refresh();
      } else {
        toast.error(res.error ?? "Couldn't update the rule.");
      }
    });
  }

  async function remove() {
    const queuedLine =
      queued > 0
        ? `\n\n${queued} queued message${queued === 1 ? "" : "s"} will be cancelled and never sent.`
        : "";
    if (
      !confirm(
        `Delete "${name}"?\n\nThis also deletes its history, so you lose the record of the emails it has already sent. Pause it instead if you might want it back.${queuedLine}`
      )
    ) {
      return;
    }

    setDeleting(true);
    const res = await deleteAutomationRule(id);
    setDeleting(false);
    if (res.success) {
      toast.success("Rule deleted");
      router.refresh();
    } else {
      toast.error(res.error ?? "Couldn't delete the rule.");
    }
  }

  return (
    <div className="flex items-center justify-end gap-0.5">
      <Link
        href={`/admin/automation/${id}/edit`}
        aria-label={`Edit ${name}`}
        title="Edit"
        className={`${ICON_BUTTON} hover:bg-muted hover:text-foreground`}
      >
        <Pencil className="h-4 w-4" />
      </Link>

      <button
        type="button"
        onClick={togglePaused}
        disabled={pending}
        aria-label={isActive ? `Pause ${name}` : `Switch on ${name}`}
        title={isActive ? "Pause" : "Switch on"}
        className={`${ICON_BUTTON} hover:bg-muted hover:text-foreground`}
      >
        {isActive ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>

      <button
        type="button"
        onClick={remove}
        disabled={deleting}
        aria-label={`Delete ${name}`}
        title="Delete"
        className={`${ICON_BUTTON} hover:bg-danger/10 hover:text-danger`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
