"use client";

/**
 * VariantTable — the per-combination price/stock grid on the "Price & Stock" tab.
 *
 * Lifted out of product-form.tsx because three things had to be reconciled and
 * they are easier to reason about in one place:
 *
 * 1. **Filter, selection and bulk edit are one mechanism, not three.** The
 *    header checkbox selects *exactly the rows the filter is showing*; the bulk
 *    bar then targets that selection. Rows hidden by the filter are never
 *    touched, even if they were selected before the filter changed — the
 *    selection is intersected with the visible rows on every action, so nothing
 *    can be edited off-screen.
 * 2. **The filter bar used to be taller than the data.** It is now one wrapping
 *    row (each option's name lives in its own "All <Option>" placeholder rather
 *    than a stacked mini-label) and collapses behind a Filters button with a
 *    count badge below `sm`.
 * 3. **The table scrolls inside its own box.** Six columns cannot fit 320px, so
 *    the alternative to a scroller is the whole admin page scrolling sideways.
 *
 * State that belongs to the product (the variant map itself) stays in the form;
 * this component only owns view state — filter, selection, bulk inputs.
 */

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { SlidersHorizontal } from "lucide-react";
import { comboKey } from "@/lib/options";
import { formatINR, cn } from "@/lib/utils";
import {
  Check,
  CountBadge,
  MiniButton,
  TableScroll,
  Toolbar,
} from "@/components/admin/form-kit";

export type VariantEntry = { available: boolean; price: string; stock: string };

type OptionGroup = { name: string; values: string[] };

export function VariantTable({
  optionMatrix,
  combos,
  entryOf,
  onPatch,
  basePrice,
  baseStock,
}: {
  optionMatrix: OptionGroup[];
  /** Every generated combination, in option order. */
  combos: Record<string, string>[];
  entryOf: (key: string) => VariantEntry;
  /** Applies one patch to many rows at once — one state update, not N. */
  onPatch: (keys: string[], patch: Partial<VariantEntry>) => void;
  /** The product's base price as typed, used as placeholder and inherit value. */
  basePrice: string;
  baseStock: string;
}) {
  const [filter, setFilter] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulk, setBulk] = useState({ price: "", stock: "", available: "" });
  // Mobile only — above `sm` the filter row is always laid out inline.
  const [filtersOpen, setFiltersOpen] = useState(false);

  const activeFilters = Object.values(filter).filter(Boolean).length;

  const filtered = useMemo(
    () =>
      combos.filter((c) =>
        Object.entries(filter).every(([name, val]) => !val || c[name] === val)
      ),
    [combos, filter]
  );
  const filteredKeys = useMemo(() => filtered.map(comboKey), [filtered]);

  /**
   * Changing a filter prunes the selection to what is still on screen, so
   * "3 of 12 selected" is the whole truth and Apply can never reach a row the
   * admin cannot see. Done here rather than in an effect: the new filter and
   * the rows it implies are both known at this point, and an effect would be a
   * second render that briefly reported a selection that no longer applies.
   */
  function applyFilter(next: Record<string, string>) {
    setFilter(next);
    const visible = new Set(
      combos
        .filter((c) =>
          Object.entries(next).every(([name, val]) => !val || c[name] === val)
        )
        .map(comboKey)
    );
    setSelected((prev) => new Set([...prev].filter((k) => visible.has(k))));
  }

  // Still intersected on read: `combos` itself changes while the admin edits
  // options on the other tab, which can retire a row that was selected.
  const selectedVisible = useMemo(
    () => filteredKeys.filter((k) => selected.has(k)),
    [filteredKeys, selected]
  );
  const allSelected =
    filteredKeys.length > 0 && selectedVisible.length === filteredKeys.length;
  const someSelected = selectedVisible.length > 0 && !allSelected;

  function toggleAll(next: boolean) {
    setSelected((prev) => {
      const s = new Set(prev);
      for (const k of filteredKeys) {
        if (next) s.add(k);
        else s.delete(k);
      }
      return s;
    });
  }

  function toggleRow(key: string, next: boolean) {
    setSelected((prev) => {
      const s = new Set(prev);
      if (next) s.add(key);
      else s.delete(key);
      return s;
    });
  }

  // Bulk targets the selection; with nothing selected it falls back to every
  // visible row, which is what the button says it will do.
  const bulkTargets = selectedVisible.length ? selectedVisible : filteredKeys;

  function applyBulk() {
    const patch: Partial<VariantEntry> = {};
    if (bulk.price !== "") patch.price = bulk.price;
    if (bulk.stock !== "") patch.stock = bulk.stock;
    if (bulk.available === "yes") patch.available = true;
    if (bulk.available === "no") patch.available = false;

    if (Object.keys(patch).length === 0) {
      toast.error("Enter a price, stock or availability first.");
      return;
    }
    if (bulkTargets.length === 0) {
      toast.error("No combinations to update.");
      return;
    }
    onPatch(bulkTargets, patch);
    toast.success(
      `Updated ${bulkTargets.length} combination${bulkTargets.length !== 1 ? "s" : ""}.`
    );
  }

  const base = Number(basePrice || 0);

  return (
    <div className="space-y-3">
      {/* ── Toolbar: filters + selection count + bulk edit, one compact block ── */}
      <Toolbar className="flex-col flex-nowrap items-stretch gap-0 p-0">
        {/* Row 1 — filters */}
        <div className="flex flex-wrap items-center gap-2 px-2.5 py-2">
          <MiniButton
            className="sm:hidden"
            active={activeFilters > 0}
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((v) => !v)}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filters
            {activeFilters > 0 && <CountBadge>{activeFilters}</CountBadge>}
          </MiniButton>

          <div
            className={cn(
              "min-w-0 flex-wrap items-center gap-2",
              filtersOpen ? "flex w-full" : "hidden sm:flex"
            )}
          >
            {optionMatrix.map((g) => (
              <select
                key={g.name}
                aria-label={`Filter by ${g.name}`}
                value={filter[g.name] ?? ""}
                onChange={(e) =>
                  applyFilter({ ...filter, [g.name]: e.target.value })
                }
                className={cn(
                  "input h-11 w-full min-w-0 sm:h-9 sm:w-auto sm:min-w-[7.5rem]",
                  filter[g.name] && "border-accent text-accent"
                )}
              >
                <option value="">All {g.name}</option>
                {g.values.map((val) => (
                  <option key={val} value={val}>
                    {val}
                  </option>
                ))}
              </select>
            ))}
            {activeFilters > 0 && (
              <MiniButton onClick={() => applyFilter({})} aria-label="Clear filters">
                Clear
              </MiniButton>
            )}
          </div>

          <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
            <b className="text-foreground">{selectedVisible.length}</b> of{" "}
            {filteredKeys.length} selected
          </span>
          {selectedVisible.length > 0 && (
            <MiniButton
              onClick={() => toggleAll(false)}
              aria-label="Clear the selection"
            >
              Deselect
            </MiniButton>
          )}
        </div>

        {/* Row 2 — bulk edit */}
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-2.5 py-2">
          <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Set
          </span>
          <div className="relative w-24 shrink-0 sm:w-28">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              ₹
            </span>
            <input
              type="number"
              min={0}
              aria-label="Bulk price"
              value={bulk.price}
              onChange={(e) => setBulk((b) => ({ ...b, price: e.target.value }))}
              className="input h-11 pl-6 sm:h-9"
              placeholder="Price"
            />
          </div>
          <input
            type="number"
            min={0}
            aria-label="Bulk stock"
            value={bulk.stock}
            onChange={(e) => setBulk((b) => ({ ...b, stock: e.target.value }))}
            className="input h-11 w-20 shrink-0 sm:h-9 sm:w-24"
            placeholder="Stock"
          />
          <select
            aria-label="Bulk availability"
            value={bulk.available}
            onChange={(e) => setBulk((b) => ({ ...b, available: e.target.value }))}
            className="input h-11 w-auto min-w-0 shrink sm:h-9"
          >
            <option value="">Availability</option>
            <option value="yes">Available</option>
            <option value="no">Unavailable</option>
          </select>
          <MiniButton
            onClick={applyBulk}
            active
            className="ml-auto"
            disabled={bulkTargets.length === 0}
          >
            {selectedVisible.length
              ? `Apply to ${selectedVisible.length} selected`
              : `Apply to all ${filteredKeys.length} shown`}
          </MiniButton>
        </div>
      </Toolbar>

      {/* ── Table ── */}
      <TableScroll>
        <table className="w-full min-w-[42rem] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-[11px] uppercase tracking-widest text-muted-foreground">
              <th scope="col" className="w-11 py-1 pl-1">
                <Check
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={toggleAll}
                  label={
                    allSelected
                      ? "Deselect all shown combinations"
                      : "Select all shown combinations"
                  }
                  disabled={filteredKeys.length === 0}
                />
              </th>
              <th scope="col" className="px-3 py-2.5 font-medium">
                Combination
              </th>
              <th scope="col" className="w-20 px-3 py-2.5 text-center font-medium">
                Available
              </th>
              <th scope="col" className="w-24 px-3 py-2.5 text-center font-medium">
                Base price
              </th>
              <th scope="col" className="w-32 px-3 py-2.5 font-medium">
                Price
              </th>
              <th scope="col" className="w-28 px-3 py-2.5 font-medium">
                Stock
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredKeys.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-xs text-muted-foreground">
                  No combination matches this filter.
                </td>
              </tr>
            )}
            {filtered.map((combo) => {
              const key = comboKey(combo);
              const v = entryOf(key);
              const useBase = v.price === "";
              const isSelected = selected.has(key);
              return (
                <tr
                  key={key}
                  className={cn(
                    "align-middle transition-colors",
                    isSelected && "bg-accent/5",
                    !v.available && "opacity-55"
                  )}
                >
                  <td className="py-1 pl-1">
                    <Check
                      checked={isSelected}
                      onChange={(next) => toggleRow(key, next)}
                      label={`Select ${Object.values(combo).join(" / ")}`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {Object.entries(combo).map(([name, value]) => (
                        <span
                          key={name}
                          className="rounded-md bg-muted px-2 py-0.5 text-xs whitespace-nowrap"
                          title={name}
                        >
                          {value}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-1 py-1 text-center">
                    <Check
                      checked={v.available}
                      onChange={(next) => onPatch([key], { available: next })}
                      label={`${Object.values(combo).join(" / ")} is available`}
                      className="mx-auto"
                    />
                  </td>
                  <td className="px-1 py-1 text-center">
                    <Check
                      checked={useBase}
                      disabled={!v.available}
                      onChange={(next) =>
                        onPatch([key], { price: next ? "" : String(base || 0) })
                      }
                      label={`Use the base price for ${Object.values(combo).join(" / ")}`}
                      className="mx-auto"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="relative">
                      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        ₹
                      </span>
                      <input
                        type="number"
                        min={0}
                        aria-label={`Price for ${Object.values(combo).join(" / ")}`}
                        value={v.price}
                        onChange={(e) => onPatch([key], { price: e.target.value })}
                        className="input h-11 pl-6 sm:h-9"
                        placeholder={basePrice || "0"}
                        disabled={!v.available || useBase}
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={0}
                      aria-label={`Stock for ${Object.values(combo).join(" / ")}`}
                      value={v.stock}
                      onChange={(e) => onPatch([key], { stock: e.target.value })}
                      className="input h-11 sm:h-9"
                      placeholder={baseStock || "0"}
                      disabled={!v.available}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>

      <p className="text-xs text-muted-foreground">
        Showing {filteredKeys.length} of {combos.length}. Blank price →{" "}
        {formatINR(base)}; blank stock → product stock.
      </p>
    </div>
  );
}
