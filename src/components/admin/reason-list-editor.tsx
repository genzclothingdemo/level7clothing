"use client";

import { useRef } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { MAX_RETURN_REASONS, MAX_RETURN_REASON_LENGTH } from "@/lib/returns";

/**
 * The editable list of grounds a return is accepted on.
 *
 * Rows carry an `id` rather than being keyed by index: renaming a reason and
 * then moving it would otherwise remount the input under the caret and throw
 * focus away mid-word. The id is generated once, on add, and never read by
 * anything outside this component — only `value` is saved.
 *
 * Reordering is up/down buttons, not drag-and-drop: the owner edits this on a
 * phone, HTML5 drag events don't fire on touch, and a drag library for five
 * rows is not a trade worth making.
 */

export type ReasonRow = { id: string; value: string };

let seq = 0;
function nextId(): string {
  seq += 1;
  return `r${seq}`;
}

/** Wrap saved strings for editing. Call once, when the form initialises. */
export function toReasonRows(values: readonly string[]): ReasonRow[] {
  return values.map((value) => ({ id: nextId(), value }));
}

/** 44px minimum, so every control clears the touch-target floor. */
const ICON_BTN =
  "grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35";

export function ReasonListEditor({
  rows,
  onChange,
  disabled,
}: {
  rows: ReasonRow[];
  onChange: (next: ReasonRow[]) => void;
  disabled?: boolean;
}) {
  // Focus the input of a row added in the previous commit — appending a blank
  // row is only half an "add" if the admin then has to go and tap it.
  const focusNext = useRef<string | null>(null);

  function setValue(id: string, value: string) {
    onChange(rows.map((r) => (r.id === id ? { ...r, value } : r)));
  }

  function remove(id: string) {
    onChange(rows.filter((r) => r.id !== id));
  }

  function move(index: number, delta: number) {
    const to = index + delta;
    if (to < 0 || to >= rows.length) return;
    const next = [...rows];
    [next[index], next[to]] = [next[to], next[index]];
    onChange(next);
  }

  function add() {
    const row = { id: nextId(), value: "" };
    focusNext.current = row.id;
    onChange([...rows, row]);
  }

  // Duplicates are merged on save, so say so before the admin presses save
  // rather than letting a row vanish afterwards.
  const seen = new Map<string, number>();
  rows.forEach((r) => {
    const key = r.value.trim().toLowerCase();
    if (!key) return;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  });

  const filled = rows.filter((r) => r.value.trim()).length;
  const full = rows.length >= MAX_RETURN_REASONS;

  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {rows.map((row, i) => {
          const key = row.value.trim().toLowerCase();
          const duplicate = !!key && (seen.get(key) ?? 0) > 1;
          return (
            <li key={row.id} className="flex flex-wrap items-center gap-2">
              <input
                ref={(el) => {
                  if (el && focusNext.current === row.id) {
                    focusNext.current = null;
                    el.focus();
                  }
                }}
                value={row.value}
                maxLength={MAX_RETURN_REASON_LENGTH}
                disabled={disabled}
                onChange={(e) => setValue(row.id, e.target.value)}
                placeholder="e.g. Wrong size"
                aria-label={`Reason ${i + 1}`}
                aria-invalid={duplicate || undefined}
                className={`input h-11 min-w-0 flex-1 basis-40 ${
                  duplicate ? "border-danger" : ""
                }`}
              />
              <div className="ml-auto flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={disabled || i === 0}
                  className={ICON_BTN}
                  aria-label={`Move "${row.value || "reason"}" up`}
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={disabled || i === rows.length - 1}
                  className={ICON_BTN}
                  aria-label={`Move "${row.value || "reason"}" down`}
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(row.id)}
                  disabled={disabled}
                  className={`${ICON_BTN} hover:border-danger/40 hover:text-danger`}
                  aria-label={`Remove "${row.value || "reason"}"`}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={add}
          disabled={disabled || full}
          className="inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-4 w-4" /> Add reason
        </button>
        <p className="text-xs text-muted-foreground">
          {filled === 0
            ? "Empty — saving keeps the standard list"
            : `${filled} of ${MAX_RETURN_REASONS}`}
        </p>
      </div>
    </div>
  );
}
