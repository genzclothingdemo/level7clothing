"use client";

/**
 * Which products can be returned — picked, not painted.
 *
 * ## What changed and why
 *
 * This control used to offer one thing: *apply to every product*. So "make this
 * one final-sale drop non-returnable" meant either twenty-two trips through the
 * product editor or a write that hit the whole catalogue. Now the normal path is
 * search → select → apply, and the catalogue-wide write is a separate, confirmed
 * action that names its own blast radius.
 *
 * ## The three states, and why the distinction is load-bearing
 *
 * `Product.returnable` is a **nullable** boolean:
 *
 *   `null`  — inherit `SiteSettings.defaultReturnable` (and made-to-order
 *             pieces are non-returnable while it is null, whatever the default)
 *   `true`  — explicitly returnable, overriding the default *and* made-to-order
 *   `false` — explicitly not
 *
 * "Everything returnable" and "everything inherits" look identical on screen
 * until the store default is later flipped — at which point the first silently
 * ignores it and the owner's one switch does nothing. Every row therefore states
 * which of the three it is *and* what that currently resolves to, and the
 * selection bar says how many rows are about to stop inheriting.
 *
 * Selection comes from `@/components/admin/selection` — shift-range, drag-sweep,
 * select-all, and the rule that selection is always intersected with the visible
 * rows, so narrowing the filter narrows what an action can hit.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, PackageSearch, Search, X } from "lucide-react";
import {
  bulkSetReturnable,
  setReturnableForProducts,
  type ReturnableMode,
  type ReturnableProduct,
} from "@/app/actions/returns";
import {
  SelectCheckbox,
  SelectionBar,
  rowSelectionProps,
  useMultiSelect,
} from "@/components/admin/selection";
import { Card, MiniButton, Toolbar } from "@/components/admin/form-kit";
import { InfoTip } from "@/components/store/info-tip";
import { Disclosure } from "@/components/store/disclosure";

/* ------------------------------------------------------------------ model */

/** What a row says. Mirrors `Product.returnable`: null / true / false. */
type ProductState = "inherit" | "yes" | "no";
type StateFilter = "all" | ProductState;

const ACTIONS: { mode: ReturnableMode; label: string; detail: string }[] = [
  {
    mode: "inherit",
    label: "Follow store default",
    detail:
      "Clears the per-product answer, so these pieces follow the catalogue default and keep following it when you change it later.",
  },
  {
    mode: "yes",
    label: "Returnable",
    detail:
      "Marks these returnable outright. They stay returnable even if you later turn the catalogue default off — and it re-admits a made-to-order piece.",
  },
  {
    mode: "no",
    label: "Not returnable",
    detail:
      "Marks these non-returnable outright — a final-sale drop, say. They stay that way even if you later turn the catalogue default on.",
  },
];

const FILTERS: { key: StateFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "inherit", label: "Inheriting" },
  { key: "yes", label: "Returnable" },
  { key: "no", label: "Not returnable" },
];

/**
 * 44px on a phone, the editor's compact 36px from `sm` up. `MiniButton` is
 * `min-h-9` by default, which is below the touch floor, and this screen is a
 * row of small buttons above a list of small rows — exactly where that matters.
 */
const TAP = "min-h-11 sm:min-h-9";

/** Which of the three a row currently says. */
function stateOf(p: ReturnableProduct): ProductState {
  return p.returnable === null ? "inherit" : p.returnable ? "yes" : "no";
}

/**
 * What a row actually resolves to today. Deliberately not `resolveReturnPolicy`
 * — that needs the full settings shape and returns policy copy; this only needs
 * the yes/no, and stating it wrong here would be worse than not stating it.
 * The precedence is the same and the two must stay in step.
 */
function effective(
  p: ReturnableProduct,
  policy: { returnsEnabled: boolean; defaultReturnable: boolean }
): { returnable: boolean; why: string } {
  if (!policy.returnsEnabled) {
    return { returnable: false, why: "returns are off store-wide" };
  }
  if (p.returnable === false) return { returnable: false, why: "set on the product" };
  if (p.returnable === true) return { returnable: true, why: "set on the product" };
  if (p.isCustomisable) {
    return { returnable: false, why: "made to order" };
  }
  return {
    returnable: policy.defaultReturnable,
    why: "store default",
  };
}

/* ------------------------------------------------------------- component */

export function ReturnableBulk({
  products,
  policy,
}: {
  products: ReturnableProduct[];
  policy: { returnsEnabled: boolean; defaultReturnable: boolean };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<StateFilter>("all");
  const [confirmAll, setConfirmAll] = useState<ReturnableMode | null>(null);

  /**
   * Writes applied locally so a row updates the instant it is saved. The server
   * has already revalidated, so once `router.refresh()` lands the override and
   * the fresh prop agree and the merge is a no-op — no effect, no re-seeding.
   */
  const [overrides, setOverrides] = useState<Map<string, boolean | null>>(new Map());

  const rows = useMemo(
    () =>
      products.map((p) =>
        overrides.has(p.id) ? { ...p, returnable: overrides.get(p.id)! } : p
      ),
    [products, overrides]
  );

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((p) => {
      if (filter !== "all" && stateOf(p) !== filter) return false;
      if (!needle) return true;
      return (
        p.name.toLowerCase().includes(needle) ||
        p.category.toLowerCase().includes(needle)
      );
    });
  }, [rows, q, filter]);

  const visibleIds = useMemo(() => visible.map((p) => p.id), [visible]);
  const selection = useMultiSelect(visibleIds);

  const counts = useMemo(() => {
    const c: Record<ProductState, number> & { total: number } = {
      inherit: 0,
      yes: 0,
      no: 0,
      total: rows.length,
    };
    for (const p of rows) c[stateOf(p)] += 1;
    return c;
  }, [rows]);

  /** How many of the selected rows are currently inheriting — the number that
   *  matters, because those are the ones about to stop tracking the default. */
  const selectedInheriting = useMemo(
    () => visible.filter((p) => selection.isSelected(p.id) && p.returnable === null).length,
    [visible, selection]
  );

  function applyToSelected(mode: ReturnableMode) {
    const ids = selection.ids;
    start(async () => {
      const res = await setReturnableForProducts(ids, mode);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const value = mode === "inherit" ? null : mode === "yes";
      setOverrides((prev) => {
        const next = new Map(prev);
        for (const id of ids) next.set(id, value);
        return next;
      });
      selection.clear();
      toast.success(
        `Updated ${res.updated} product${res.updated === 1 ? "" : "s"}`
      );
      router.refresh();
    });
  }

  function applyToAll(mode: ReturnableMode) {
    start(async () => {
      const res = await bulkSetReturnable(mode);
      setConfirmAll(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const value = mode === "inherit" ? null : mode === "yes";
      setOverrides(new Map(products.map((p) => [p.id, value])));
      selection.clear();
      toast.success(
        `Updated all ${res.updated} product${res.updated === 1 ? "" : "s"}`
      );
      router.refresh();
    });
  }

  return (
    <Card
      title="Which products can be returned"
      tip="Each product answers yes, no, or nothing — and “nothing” means it follows the catalogue default and keeps following it. Pick the pieces you want to change, then apply."
      aside={
        <p className="text-xs text-muted-foreground">
          <b className="text-foreground">{counts.inherit}</b> inheriting ·{" "}
          <b className="text-foreground">{counts.yes}</b> yes ·{" "}
          <b className="text-foreground">{counts.no}</b> no
        </p>
      }
    >
      {!policy.returnsEnabled && (
        <p className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-xs leading-relaxed text-danger">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Returns are switched off store-wide, so nothing here is returnable
          whatever a row says. These settings take effect again when returns are
          turned back on.
        </p>
      )}

      {/* ── search + state filter ─────────────────────────────────────── */}
      <Toolbar>
        <label className="relative min-w-0 flex-1 basis-40">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search products"
            aria-label="Search products"
            className="input h-11 w-full pl-8 text-sm sm:h-9"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label="Clear search"
              className="absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </label>

        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <MiniButton
              key={f.key}
              active={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={TAP}
            >
              {f.label}
              {f.key !== "all" && (
                <span className="tabular-nums opacity-70">{counts[f.key]}</span>
              )}
            </MiniButton>
          ))}
        </div>
      </Toolbar>

      {/* ── select-all + bulk actions ─────────────────────────────────── */}
      {visible.length > 0 && (
        <div className="flex min-h-11 items-center rounded-lg border border-border px-1">
          <SelectCheckbox
            checked={selection.allVisibleSelected}
            indeterminate={selection.someVisibleSelected}
            onChange={selection.toggleAll}
            label={
              selection.allVisibleSelected
                ? "Clear selection"
                : `Select all ${visible.length} shown`
            }
          />
          {/* The label toggles too — a 16px box beside dead text is a mis-tap. */}
          <button
            type="button"
            onClick={selection.toggleAll}
            className="min-h-11 flex-1 cursor-pointer text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {selection.allVisibleSelected ? "Clear" : "Select"} all{" "}
            {visible.length} shown
          </button>
        </div>
      )}

      <SelectionBar selection={selection} noun="product">
        {ACTIONS.map((a) => (
          <MiniButton
            key={a.mode}
            disabled={pending}
            onClick={() => applyToSelected(a.mode)}
            className={TAP}
          >
            {a.label}
          </MiniButton>
        ))}
      </SelectionBar>

      {selection.count > 0 && selectedInheriting > 0 && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {selectedInheriting} of the selected{" "}
          {selectedInheriting === 1 ? "product currently follows" : "products currently follow"}{" "}
          the catalogue default. Setting an explicit yes or no stops{" "}
          {selectedInheriting === 1 ? "it" : "them"} tracking it.
        </p>
      )}

      {/* ── the rows ──────────────────────────────────────────────────── */}
      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <PackageSearch className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">
            {rows.length === 0
              ? "No products yet."
              : "No products match that search or filter."}
          </p>
        </div>
      ) : (
        <ul
          // `select-none` so a drag-sweep doesn't paint the row labels blue.
          className="max-h-96 select-none overflow-y-auto overscroll-contain rounded-lg border border-border"
        >
          {visible.map((p) => {
            const on = selection.isSelected(p.id);
            const state = stateOf(p);
            const eff = effective(p, policy);
            const sweep = rowSelectionProps(selection, p.id);
            return (
              <li
                key={p.id}
                onPointerEnter={sweep.onPointerEnter}
                /*
                 * **The whole row is the target, and it is the only handler.**
                 *
                 * The trap avoided here: `SelectCheckbox` fires from its own span's
                 * CLICK while `rowSelectionProps` fires from the row's POINTERDOWN, so
                 * wiring both to toggle means a press on the checkbox toggles twice and
                 * lands back where it started. Giving the checkbox a no-op `onChange`
                 * leaves exactly one handler for every press — body, 44px box or the
                 * 16px input alike — and no guard is needed to tell them apart.
                 *
                 * Shift is handled here rather than on a click handler because
                 * `rowSelectionProps` deliberately refuses a shift-press (a range must
                 * never start a sweep), so the range has to be raised in its place.
                 */
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  if (e.shiftKey) {
                    selection.select(p.id, { shift: true });
                    return;
                  }
                  sweep.onPointerDown(e);
                }}
                className={`flex min-h-11 items-center border-b border-border/60 last:border-0 ${
                  on ? "bg-accent/5" : "hover:bg-muted/40"
                }`}
              >
                <span
                  /*
                   * `pointer-events-none` on the 16px box itself, which is the fix for
                   * a genuinely surprising dead spot: a press landing on that input did
                   * not reach the row's `onPointerDown` at all, so clicking the
                   * checkbox — the most obvious target on the row — did nothing, while
                   * clicking anywhere else worked. Taking the input out of hit-testing
                   * makes every press land on this 44px span and bubble to the row, so
                   * there is one target and one handler. It stays focusable, so the
                   * keyboard path below is unaffected.
                   */
                  className="flex shrink-0 [&_input]:pointer-events-none"
                  /* Keyboard has no pointerdown, and `SelectCheckbox`'s input has a
                     no-op onChange of its own, so Space on the focused box would
                     otherwise do nothing. preventDefault stops the browser turning
                     that Space into a click the row would then count again. */
                  onKeyDown={(e) => {
                    if (e.key !== " " && e.key !== "Enter") return;
                    e.preventDefault();
                    selection.select(p.id, { shift: e.shiftKey });
                  }}
                >
                  <SelectCheckbox
                    checked={on}
                    // Deliberately inert: the row's pointerdown already toggled it.
                    onChange={() => {}}
                    label={`Select ${p.name}`}
                  />
                </span>
                <div className="min-w-0 flex-1 py-1.5 pr-2">
                  <p className="break-words text-sm font-medium">
                    {p.name}
                    {!p.isActive && (
                      <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                        · draft
                      </span>
                    )}
                  </p>
                  <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
                    <span className="truncate">{p.category}</span>
                    <StateBadge state={state} />
                    <span>
                      →{" "}
                      <span
                        className={eff.returnable ? "text-success" : "text-danger"}
                      >
                        {eff.returnable ? "returnable" : "not returnable"}
                      </span>{" "}
                      ({eff.why})
                    </span>
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* ── the catalogue-wide path, kept separate and confirmed ───────── */}
      <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 sm:px-4">
        <Disclosure
          label="Apply to every product"
          summary={`all ${counts.total}`}
        >
          <p className="text-xs leading-relaxed text-muted-foreground">
            Rewrites the answer on <b>every</b> product, including any not shown
            by the filter above, and cannot be undone in one step.{" "}
            <b>Follow store default</b> is the safe one — it hands control back
            to the single catalogue switch instead of freezing today&apos;s
            answer onto every row.
          </p>

          <div className="mt-3 space-y-2">
            {ACTIONS.map((a) => (
              <div
                key={a.mode}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-2.5"
              >
                <p className="flex items-center gap-1 text-sm font-medium">
                  {a.label}
                  <InfoTip term={a.label}>{a.detail}</InfoTip>
                </p>
                {confirmAll === a.mode ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <MiniButton
                      disabled={pending}
                      onClick={() => applyToAll(a.mode)}
                      className={`${TAP} border-danger/50 bg-danger/10 text-danger hover:bg-danger/20`}
                    >
                      {pending ? "Applying…" : `Yes, all ${counts.total}`}
                    </MiniButton>
                    <MiniButton className={TAP} disabled={pending} onClick={() => setConfirmAll(null)}>
                      Cancel
                    </MiniButton>
                  </div>
                ) : (
                  <MiniButton className={TAP} disabled={pending} onClick={() => setConfirmAll(a.mode)}>
                    Apply to all
                  </MiniButton>
                )}
              </div>
            ))}
          </div>
        </Disclosure>
      </div>
    </Card>
  );
}

function StateBadge({ state }: { state: ProductState }) {
  const look =
    state === "inherit"
      ? "border-border text-muted-foreground"
      : state === "yes"
        ? "border-success/40 text-success"
        : "border-danger/40 text-danger";
  const label =
    state === "inherit" ? "inherits" : state === "yes" ? "set yes" : "set no";
  return (
    <span
      className={`shrink-0 rounded-full border px-1.5 text-[10px] font-medium ${look}`}
    >
      {label}
    </span>
  );
}
