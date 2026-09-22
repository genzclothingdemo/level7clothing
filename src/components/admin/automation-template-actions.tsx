"use client";

/**
 * Edit / delete for one email template.
 *
 * The delete button is **rendered disabled rather than hidden** for a system
 * template or one a rule is using. A missing button raises "why can't I delete
 * this?"; a disabled one with a title says so. Both refusals are enforced again
 * in `deleteEmailTemplate` — the UI explains the rule, the server is the rule.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteEmailTemplate } from "@/app/actions/automation";

const ICON_BUTTON =
  "inline-grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-40 sm:h-9 sm:w-9";

export function AutomationTemplateActions({
  id,
  name,
  isSystem,
  usedBy,
}: {
  id: string;
  name: string;
  isSystem: boolean;
  usedBy: number;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  const blocked = isSystem
    ? "Ships with the store — editable, but not deletable"
    : usedBy > 0
      ? `${usedBy} rule${usedBy === 1 ? "" : "s"} still use${usedBy === 1 ? "s" : ""} this`
      : null;

  async function remove() {
    if (!confirm(`Delete the "${name}" template?`)) return;
    setDeleting(true);
    const res = await deleteEmailTemplate(id);
    setDeleting(false);
    if (res.success) {
      toast.success("Template deleted");
      router.refresh();
    } else {
      toast.error(res.error ?? "Couldn't delete the template.");
    }
  }

  return (
    <div className="flex items-center justify-end gap-0.5">
      <Link
        href={`/admin/automation/templates/${id}/edit`}
        aria-label={`Edit ${name}`}
        title="Edit"
        className={`${ICON_BUTTON} cursor-pointer hover:bg-muted hover:text-foreground`}
      >
        <Pencil className="h-4 w-4" />
      </Link>

      <button
        type="button"
        onClick={remove}
        disabled={deleting || Boolean(blocked)}
        aria-label={blocked ? `${name} can't be deleted: ${blocked}` : `Delete ${name}`}
        title={blocked ?? "Delete"}
        className={`${ICON_BUTTON} ${blocked ? "" : "cursor-pointer hover:bg-danger/10 hover:text-danger"}`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
