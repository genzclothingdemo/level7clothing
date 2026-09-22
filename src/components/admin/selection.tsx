"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Multi-select for admin tables — one implementation, every screen.
 *
 * Products, media, orders, portfolio and returns had each grown their own
 * checkbox handling, and each supported a different subset: some had
 * select-all, none had shift-range, none had drag. This is the shared one.
 *
 * Three selection gestures, which is what people expect from a file manager:
 *
 *   click        toggle one
 *   shift-click  select the range from the last click to this one
 *   drag         press on a row and sweep — the rows under the pointer take
 *                the state the first row was moved TO, so a sweep starting on
 *                an unselected row selects, and one starting on a selected row
 *                deselects
 *
 * **Selection is always intersected with what is currently visible.** That is
 * the rule that makes bulk actions safe: narrowing a filter must narrow what a
 * bulk action can hit, or an admin selects 30 rows, filters to 3, presses
 * Delete and loses 30. `visibleIds` is the authority; anything selected that
 * has scrolled out of the filter is dropped, not remembered.
 */
export function useMultiSelect(visibleIds: string[]) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const lastIndexRef = useRef<number | null>(null);

  // The visible set changes whenever a filter, a page or a search changes.
  const visible = useMemo(() => new Set(visibleIds), [visibleIds]);

  // Prune to what is on screen. Without this the count lies and a bulk action
  // reaches rows the admin can no longer see.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<string>();
      for (const id of prev) if (visible.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
  }, [visible]);

  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  const setMany = useCallback((ids: string[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  /** Click a row. `shift` extends from the previous click. */
  const select = useCallback(
    (id: string, opts: { shift?: boolean } = {}) => {
      const index = visibleIds.indexOf(id);
      if (index < 0) return;

      const anchor = lastIndexRef.current;
      if (opts.shift && anchor !== null && anchor !== index) {
        const [from, to] = anchor < index ? [anchor, index] : [index, anchor];
        // A shift-range always SELECTS. Making it mirror the clicked row's
        // state means a range can silently clear rows the admin never saw.
        setMany(visibleIds.slice(from, to + 1), true);
        // Anchor deliberately not moved: successive shift-clicks should grow
        // from the original point, as they do in a file manager.
        return;
      }

      lastIndexRef.current = index;
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [visibleIds, setMany]
  );

  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someVisibleSelected = !allVisibleSelected && selected.size > 0;

  const toggleAll = useCallback(() => {
    setMany(visibleIds, !allVisibleSelected);
    lastIndexRef.current = null;
  }, [visibleIds, allVisibleSelected, setMany]);

  const clear = useCallback(() => {
    setSelected(new Set());
    lastIndexRef.current = null;
  }, []);

  /* ---- drag to sweep ------------------------------------------------- */
  const dragMode = useRef<boolean | null>(null);

  const dragStart = useCallback(
    (id: string) => {
      // The sweep applies the state this row is moving TO, so dragging from an
      // unselected row selects and from a selected row deselects.
      const on = !selected.has(id);
      dragMode.current = on;
      setMany([id], on);
      lastIndexRef.current = visibleIds.indexOf(id);
    },
    [selected, setMany, visibleIds]
  );

  const dragOver = useCallback(
    (id: string) => {
      if (dragMode.current === null) return;
      setMany([id], dragMode.current);
    },
    [setMany]
  );

  // Ends on pointerup anywhere, including outside the table — otherwise
  // releasing off the edge leaves the sweep armed and the next hover selects.
  useEffect(() => {
    const end = () => {
      dragMode.current = null;
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, []);

  return {
    selected,
    ids: useMemo(() => [...selected], [selected]),
    count: selected.size,
    isSelected,
    select,
    toggleAll,
    clear,
    allVisibleSelected,
    someVisibleSelected,
    dragStart,
    dragOver,
    visibleCount: visibleIds.length,
  };
}

export type MultiSelect = ReturnType<typeof useMultiSelect>;

/**
 * A checkbox that reports the real `indeterminate` DOM property — it cannot be
 * set from JSX, only from a ref, which is why this exists rather than a plain
 * `<input>`.
 */
export function SelectCheckbox({
  checked,
  indeterminate = false,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (e: React.MouseEvent) => void;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);

  return (
    // 44px hit area around a 16px box: this sits in dense table rows where the
    // box itself would be far below the touch minimum.
    <span
      className={cn("grid h-11 w-11 shrink-0 place-items-center", className)}
      onClick={onChange}
    >
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        aria-label={label}
        onChange={() => {}}
        onClick={(e) => e.stopPropagation()}
        className="h-4 w-4 cursor-pointer accent-[var(--accent)]"
      />
    </span>
  );
}

/**
 * The bar that appears once something is selected.
 *
 * It states the count against the visible total, because "12 selected" is
 * ambiguous the moment a filter is on — 12 of what?
 */
export function SelectionBar({
  selection,
  children,
  noun = "item",
}: {
  selection: MultiSelect;
  /** Bulk actions. Rendered only while there is a selection. */
  children?: React.ReactNode;
  noun?: string;
}) {
  if (selection.count === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 p-2">
      <p className="text-xs font-medium">
        {selection.count} of {selection.visibleCount} {noun}
        {selection.visibleCount === 1 ? "" : "s"} selected
      </p>
      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
        {children}
        <button
          type="button"
          onClick={selection.clear}
          className="min-h-11 rounded-lg px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground sm:min-h-9"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

/**
 * Anything that is already a control. A press on one of these must not also
 * start a selection sweep — every row in this admin carries an Edit link, a
 * Delete button and often a product link, and a bare `pointerdown` listener on
 * the row fires for all of them. Pressing Delete would toggle the row's
 * selection on the way to the confirm.
 *
 * It also covers the row's own checkbox, which is what stops a click there
 * from toggling twice: once from the sweep and once from the input.
 */
const INTERACTIVE = "a,button,input,select,textarea,label,[role=button],[contenteditable]";

/**
 * Props to spread onto a selectable row so the drag sweep works.
 *
 * `onPointerEnter` is what makes a sweep continue across rows; the hook
 * ignores it unless a drag is actually in progress.
 *
 * Prefer `SelectHandle` where the rows contain controls — sweeping the
 * checkbox column is the gesture people already have from every mail client,
 * and it cannot be confused with pressing something.
 */
export function rowSelectionProps(selection: MultiSelect, id: string) {
  return {
    onPointerDown: (e: React.PointerEvent) => {
      // Only a primary-button press with no modifier starts a sweep — shift is
      // range-select, and a right-click is a context menu.
      if (e.button !== 0 || e.shiftKey) return;
      if ((e.target as HTMLElement).closest?.(INTERACTIVE)) return;
      selection.dragStart(id);
    },
    onPointerEnter: () => selection.dragOver(id),
  };
}

/**
 * The per-row handle: a checkbox that is also the drag surface.
 *
 * Two things it gets right that a plain checkbox plus `rowSelectionProps` on
 * the row does not:
 *
 * - **The gesture lives in the checkbox column**, so it can never be confused
 *   with pressing one of the row's own controls.
 * - **A mouse toggles on `pointerdown`, not on `click`.** A sweep that starts
 *   on row A and releases on row C never fires a click on A, so a
 *   click-driven toggle leaves the first row of every drag unselected. The
 *   keyboard path survives because a Space- or Enter-generated click reports
 *   `detail === 0` and a real pointer click never does.
 */
export function SelectHandle({
  selection,
  id,
  label,
  className,
}: {
  selection: MultiSelect;
  id: string;
  label: string;
  className?: string;
}) {
  const checked = selection.isSelected(id);
  const ref = useRef<HTMLInputElement>(null);

  // Never indeterminate on a row — only the header checkbox is.
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = false;
  }, [checked]);

  return (
    <span
      className={cn("grid h-11 w-11 shrink-0 place-items-center", className)}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        if (e.shiftKey) {
          selection.select(id, { shift: true });
          return;
        }
        selection.dragStart(id);
      }}
      onPointerEnter={() => selection.dragOver(id)}
    >
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        aria-label={label}
        onChange={() => {}}
        onClick={(e) => {
          if (e.detail === 0) selection.select(id, { shift: e.shiftKey });
        }}
        className="h-4 w-4 cursor-pointer accent-[var(--accent)]"
      />
    </span>
  );
}
