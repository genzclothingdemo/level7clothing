"use client";

/**
 * VariantTable — the per-combination grid on the "Price & Stock" tab.
 *
 * One row per combination of the product's options, and one `ProductVariant`
 * row behind each. Lifted out of product-form.tsx because several things have
 * to be reconciled and they are easier to reason about in one place:
 *
 * 1. **Filter, selection and bulk edit are one mechanism, not three.** The
 *    header checkbox selects *exactly the rows the filter is showing*; the bulk
 *    bar then targets that selection. Rows hidden by the filter are never
 *    touched, even if they were selected before the filter changed — the
 *    selection is intersected with the visible rows on every action, so nothing
 *    can be edited off-screen.
 * 2. **Three views, not one twelve-column table.** Price (what it sells for,
 *    what it cost, the margin), SKU (SKU and barcode) and Stock. A combination
 *    has more facts than fit 320px — or a laptop — and the owner asks one
 *    question at a time: "what do these sell for", "what are they called",
 *    "how many are left".
 * 3. **What a blank inherits is on screen, not implied.** A blank price shows
 *    the base it inherits and the Sells-at column shows the settled number
 *    from `settleVariantPrices` — the same function the server writes the
 *    mirror checkout charges from — so an empty box cannot be read as ₹0 and
 *    the grid cannot promise a price the checkout will not charge.
 * 4. **Stock has one writer.** For a tracked product the stock cells are a
 *    read-out of the ledger with a link to Inventory; `lib/inventory.ts` is
 *    the only thing that moves those numbers. An untracked product keeps the
 *    per-combination stock input exactly as before.
 * 5. **The table scrolls inside its own box**, so the alternative to a scroller
 *    — the whole admin page scrolling sideways — never happens.
 *
 * State that belongs to the product (the entries themselves) stays in the
 * form; this component only owns view state — filter, selection, bulk inputs.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowUpRight, SlidersHorizontal } from "lucide-react";
import { comboKey } from "@/lib/options";
import { SKU_PATTERN, normaliseSku } from "@/lib/sku";
import { STOCK_STATE_META, stockStateOf } from "@/lib/inventory-types";
import { InfoTip } from "@/components/store/info-tip";
import { formatINR, cn } from "@/lib/utils";
import {
  Check,
  CountBadge,
  MiniButton,
  Segmented,
  TableScroll,
  Toolbar,
} from "@/components/admin/form-kit";

/** One combination as the editor holds it. Every field is the raw input string. */
export type VariantEntry = {
  available: boolean;
  /** "" = inherit the base price. */
  price: string;
  /** "" = inherit the product stock (untracked products only). */
  stock: string;
  /** "" on a new combination = generated on save. */
  sku: string;
  barcode: string;
  compareAtPrice: string;
  /** "" = the product's cost price. */
  costPrice: string;
  /** "" = the store's low-stock threshold. */
  lowStockAt: string;
};

export const EMPTY_VARIANT_ENTRY: VariantEntry = {
  available: true,
  price: "",
  stock: "",
  sku: "",
  barcode: "",
  compareAtPrice: "",
  costPrice: "",
  lowStockAt: "",
};

/** What the database already holds for a combination. Read-only here. */
export type VariantRowFacts = {
  id: string;
  key: string;
  combo: Record<string, string>;
  sku: string;
  isActive: boolean;
  onHand: number;
  reserved: number;
  available: number;
  movements: number;
};

/**
 * A `ProductVariant` row as the edit and new pages hand it to the editor.
 * A type only, so the server pages may import it from this client module.
 */
export type VariantRowDTO = VariantRowFacts & {
  barcode: string | null;
  price: number | null;
  compareAtPrice: number | null;
  costPrice: number | null;
  lowStockAt: number | null;
};

export type VariantView = "price" | "sku" | "stock";

/** A save the server refused, pinned to the row and column it is about. */
export type VariantFieldError = { key?: string; field?: string; message: string };

type OptionGroup = { name: string; values: string[] };

/** "" → null; otherwise a whole number of rupees (or units), never negative. */
export function entryNumber(raw: string): number | null {
  if (raw == null || String(raw).trim() === "") return null;
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const VIEWS: { value: VariantView; label: string }[] = [
  { value: "price", label: "Price" },
  { value: "sku", label: "SKU" },
  { value: "stock", label: "Stock" },
];

const EMPTY_BULK = {
  price: "",
  compareAtPrice: "",
  costPrice: "",
  stock: "",
  lowStockAt: "",
  available: "",
};

export function VariantTable({
  optionMatrix,
  combos,
  entryOf,
  onPatch,
  view,
  onViewChange,
  perCombination,
  basePrice,
  sellsAt,
  productCost,
  productCompareAt,
  baseStock,
  tracked,
  facts,
  retired,
  lowStockDefault,
  skuPreview,
  error,
  inventoryHref,
}: {
  optionMatrix: OptionGroup[];
  /** Every generated combination, in option order. */
  combos: Record<string, string>[];
  entryOf: (key: string) => VariantEntry;
  /** Applies one patch to many rows at once — one state update, not N. */
  onPatch: (keys: string[], patch: Partial<VariantEntry>) => void;
  view: VariantView;
  onViewChange: (v: VariantView) => void;
  /** "Separate prices" is on: price, compare-at, availability and stock vary per row. */
  perCombination: boolean;
  /** The base price as typed — what a blank price inherits. */
  basePrice: number;
  /** What a combination sells for, settled exactly as the server will store it. */
  sellsAt: (key: string) => number;
  productCost: number | null;
  productCompareAt: number | null;
  baseStock: string;
  tracked: boolean;
  /** Existing rows, by combination key. */
  facts: Map<string, VariantRowFacts>;
  /** Rows kept for their stock history after their combination was removed. */
  retired: VariantRowFacts[];
  lowStockDefault: number;
  /** The SKU a new combination will be given if the admin types none. */
  skuPreview: (combo: Record<string, string>) => string;
  error?: VariantFieldError | null;
  inventoryHref: string;
}) {
  const [filter, setFilter] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulk, setBulk] = useState(EMPTY_BULK);
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

  /** Which bulk inputs this view offers. A view with none shows no bulk row. */
  const bulkFields = {
    price: view === "price" && perCombination,
    compareAtPrice: view === "price" && perCombination,
    costPrice: view === "price",
    available: view === "price" && perCombination,
    stock: view === "stock" && perCombination && !tracked,
    lowStockAt: view === "stock",
  };
  const hasBulk = Object.values(bulkFields).some(Boolean);

  function applyBulk() {
    const patch: Partial<VariantEntry> = {};
    if (bulkFields.price && bulk.price !== "") patch.price = bulk.price;
    if (bulkFields.compareAtPrice && bulk.compareAtPrice !== "")
      patch.compareAtPrice = bulk.compareAtPrice;
    if (bulkFields.costPrice && bulk.costPrice !== "") patch.costPrice = bulk.costPrice;
    if (bulkFields.stock && bulk.stock !== "") patch.stock = bulk.stock;
    if (bulkFields.lowStockAt && bulk.lowStockAt !== "") patch.lowStockAt = bulk.lowStockAt;
    if (bulkFields.available && bulk.available === "yes") patch.available = true;
    if (bulkFields.available && bulk.available === "no") patch.available = false;

    if (Object.keys(patch).length === 0) {
      toast.error("Enter a value to set first.");
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

  /* ---- SKUs: what each row will be saved as, to flag duplicates ---- */
  const finalSku = useMemo(() => {
    const out = new Map<string, string>();
    for (const combo of combos) {
      const key = comboKey(combo);
      const typed = normaliseSku(entryOf(key).sku);
      out.set(key, typed || facts.get(key)?.sku || skuPreview(combo));
    }
    return out;
  }, [combos, entryOf, facts, skuPreview]);
  const duplicateSkus = useMemo(() => {
    const count = new Map<string, number>();
    for (const s of finalSku.values()) count.set(s, (count.get(s) ?? 0) + 1);
    for (const r of retired) count.set(r.sku, (count.get(r.sku) ?? 0) + 1);
    return new Set([...count].filter(([, n]) => n > 1).map(([s]) => s));
  }, [finalSku, retired]);

  // "New" only means something next to rows that already exist.
  const showNewBadge = facts.size > 0;
  const minWidth =
    view === "price" ? "min-w-[46rem]" : view === "sku" ? "min-w-[34rem]" : "min-w-[36rem]";
  const colCount =
    1 +
    1 +
    (view === "price" ? (perCombination ? 6 : 3) : view === "sku" ? 2 : tracked ? 4 : 2);

  const errorFor = (key: string, field: string) =>
    error && error.key === key && error.field === field ? error.message : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={view}
          onChange={onViewChange}
          options={VIEWS}
          ariaLabel="Which columns to show"
          className="sm:w-auto sm:min-w-[18rem]"
        />
        {view === "stock" && tracked && (
          <Link
            href={inventoryHref}
            className="ml-auto inline-flex min-h-11 items-center gap-1 text-xs font-medium underline underline-offset-2 hover:text-accent"
          >
            Adjust stock in Inventory <ArrowUpRight className="h-3 w-3" />
          </Link>
        )}
      </div>

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

        {/* Row 2 — bulk edit, only the fields this view can set */}
        {hasBulk && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border px-2.5 py-2">
            <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              Set
            </span>
            {bulkFields.price && (
              <RupeeInput
                aria-label="Bulk price"
                value={bulk.price}
                onChange={(v) => setBulk((b) => ({ ...b, price: v }))}
                placeholder="Price"
                className="w-24 shrink-0 sm:w-28"
              />
            )}
            {bulkFields.compareAtPrice && (
              <RupeeInput
                aria-label="Bulk compare-at price"
                value={bulk.compareAtPrice}
                onChange={(v) => setBulk((b) => ({ ...b, compareAtPrice: v }))}
                placeholder="Compare-at"
                className="w-28 shrink-0 sm:w-32"
              />
            )}
            {bulkFields.costPrice && (
              <RupeeInput
                aria-label="Bulk cost price"
                value={bulk.costPrice}
                onChange={(v) => setBulk((b) => ({ ...b, costPrice: v }))}
                placeholder="Cost"
                className="w-24 shrink-0 sm:w-28"
              />
            )}
            {bulkFields.stock && (
              <input
                type="number"
                min={0}
                aria-label="Bulk stock"
                value={bulk.stock}
                onChange={(e) => setBulk((b) => ({ ...b, stock: e.target.value }))}
                className="input h-11 w-20 shrink-0 sm:h-9 sm:w-24"
                placeholder="Stock"
              />
            )}
            {bulkFields.lowStockAt && (
              <input
                type="number"
                min={0}
                aria-label="Bulk low-stock alert"
                value={bulk.lowStockAt}
                onChange={(e) => setBulk((b) => ({ ...b, lowStockAt: e.target.value }))}
                className="input h-11 w-28 shrink-0 sm:h-9 sm:w-32"
                placeholder="Low-stock at"
              />
            )}
            {bulkFields.available && (
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
            )}
            <div className="ml-auto flex flex-wrap gap-2">
              {bulkFields.price && (
                <MiniButton
                  onClick={() => {
                    if (bulkTargets.length === 0) return;
                    onPatch(bulkTargets, { price: "" });
                    toast.success(
                      `${bulkTargets.length} combination${bulkTargets.length !== 1 ? "s" : ""} back on the base price.`
                    );
                  }}
                  disabled={bulkTargets.length === 0}
                  title="Clear the price on these rows so they sell at the base price"
                >
                  Use base price
                </MiniButton>
              )}
              <MiniButton onClick={applyBulk} active disabled={bulkTargets.length === 0}>
                {selectedVisible.length
                  ? `Apply to ${selectedVisible.length} selected`
                  : `Apply to all ${filteredKeys.length} shown`}
              </MiniButton>
            </div>
          </div>
        )}
      </Toolbar>

      {/* ── Table ── */}
      <TableScroll>
        <table className={cn("w-full text-sm", minWidth)}>
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

              {view === "price" && (
                <>
                  {perCombination && (
                    <th scope="col" className="w-20 px-3 py-2.5 text-center font-medium">
                      Available
                    </th>
                  )}
                  {perCombination && (
                    <Th
                      className="w-32"
                      label="Price"
                      tip={`Leave it blank to sell at the base price (${formatINR(basePrice)}). A price here is this combination's own and stops following the base.`}
                    />
                  )}
                  <Th
                    className="w-24"
                    label="Sells at"
                    tip="What checkout charges for this combination — the price after inheriting. It is the same number the storefront shows."
                  />
                  {perCombination && (
                    <Th
                      className="w-32"
                      label="Compare-at"
                      tip={
                        <>
                          This combination&apos;s own &ldquo;was&rdquo; price.
                          Blank uses the product&apos;s
                          {productCompareAt != null ? ` (${formatINR(productCompareAt)})` : ""}
                          , set by Discount %. The product page shows the
                          product&apos;s Discount % until it reads per-size
                          compare-at prices.
                        </>
                      }
                    />
                  )}
                  <Th
                    className="w-32"
                    label="Cost"
                    tip={`What one unit cost you. Blank uses the product's cost price${productCost != null ? ` (${formatINR(productCost)})` : ""}. Never shown to customers.`}
                  />
                  <Th
                    className="w-28"
                    label="Margin"
                    tip="Sells-at minus cost, and that as a share of the price. Shown once a cost is known."
                  />
                </>
              )}

              {view === "sku" && (
                <>
                  <Th
                    className="w-60"
                    label="SKU"
                    tip="Printed on labels and typed into courier forms, so it never changes by itself — renaming the product leaves it as it is. A new combination gets one generated when you save; type your own to replace it. Unique across the whole store."
                  />
                  <Th
                    className="w-44"
                    label="Barcode"
                    tip="EAN, UPC or your own barcode label. Optional, and unique across the store."
                  />
                </>
              )}

              {view === "stock" && (
                <>
                  {tracked ? (
                    <>
                      <Th
                        className="w-24"
                        label="Available"
                        tip="On hand minus what open orders have reserved — what the storefront can still sell."
                      />
                      <Th className="w-24" label="On hand" />
                      <Th className="w-24" label="Reserved" />
                    </>
                  ) : (
                    <Th
                      className="w-32"
                      label="Stock"
                      tip={
                        perCombination
                          ? "Units for this combination. Blank uses the product's stock."
                          : "Every combination shares the product's stock. Switch on Separate prices to count them separately — or track the product in Inventory for exact per-size stock."
                      }
                    />
                  )}
                  <Th
                    className="w-36"
                    label="Low-stock at"
                    tip={
                      tracked
                        ? `Flagged as low stock at or below this many available. Blank uses the store default (${lowStockDefault}).`
                        : `Flagged as low stock at or below this many — once this product is tracked in Inventory. Blank uses the store default (${lowStockDefault}).`
                    }
                  />
                </>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredKeys.length === 0 && (
              <tr>
                <td colSpan={colCount} className="px-3 py-6 text-center text-xs text-muted-foreground">
                  No combination matches this filter.
                </td>
              </tr>
            )}
            {filtered.map((combo) => {
              const key = comboKey(combo);
              const v = entryOf(key);
              const f = facts.get(key);
              const name = Object.values(combo).join(" / ");
              const isSelected = selected.has(key);
              const sells = sellsAt(key);
              const cost = entryNumber(v.costPrice) ?? productCost;

              return (
                <tr
                  key={key}
                  className={cn(
                    "align-middle transition-colors",
                    isSelected && "bg-accent/5",
                    perCombination && !v.available && "opacity-55"
                  )}
                >
                  <td className="py-1 pl-1">
                    <Check
                      checked={isSelected}
                      onChange={(next) => toggleRow(key, next)}
                      label={`Select ${name}`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {Object.entries(combo).map(([optName, value]) => (
                        <span
                          key={optName}
                          className="rounded-md bg-muted px-2 py-0.5 text-xs whitespace-nowrap"
                          title={optName}
                        >
                          {value}
                        </span>
                      ))}
                      {showNewBadge && !f && (
                        <span className="rounded-md bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-widest text-accent">
                          New
                        </span>
                      )}
                    </div>
                  </td>

                  {view === "price" && (
                    <>
                      {perCombination && (
                        <td className="px-1 py-1 text-center">
                          <Check
                            checked={v.available}
                            onChange={(next) => onPatch([key], { available: next })}
                            label={`${name} is available`}
                            className="mx-auto"
                          />
                        </td>
                      )}
                      {perCombination && (
                        <td className="px-3 py-2">
                          <RupeeInput
                            aria-label={`Price for ${name}`}
                            value={v.price}
                            onChange={(val) => onPatch([key], { price: val })}
                            placeholder={`Base · ${basePrice}`}
                          />
                        </td>
                      )}
                      <td className="px-3 py-2">
                        <span className="font-semibold tabular-nums">{formatINR(sells)}</span>
                        <span className="block text-[10px] uppercase tracking-widest text-muted-foreground">
                          {perCombination && entryNumber(v.price) ? "Own price" : "Base"}
                        </span>
                      </td>
                      {perCombination && (
                        <td className="px-3 py-2">
                          <RupeeInput
                            aria-label={`Compare-at price for ${name}`}
                            value={v.compareAtPrice}
                            onChange={(val) => onPatch([key], { compareAtPrice: val })}
                            placeholder={productCompareAt != null ? `Product · ${productCompareAt}` : "—"}
                          />
                        </td>
                      )}
                      <td className="px-3 py-2">
                        <RupeeInput
                          aria-label={`Cost price for ${name}`}
                          value={v.costPrice}
                          onChange={(val) => onPatch([key], { costPrice: val })}
                          placeholder={productCost != null ? `Product · ${productCost}` : "—"}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Margin price={sells} cost={cost} />
                      </td>
                    </>
                  )}

                  {view === "sku" && (
                    <>
                      <td className="px-3 py-2">
                        <SkuInput
                          name={name}
                          value={v.sku}
                          existing={f?.sku ?? null}
                          preview={f ? null : finalSku.get(key) ?? ""}
                          duplicate={duplicateSkus.has(finalSku.get(key) ?? "")}
                          serverError={errorFor(key, "sku")}
                          onChange={(val) => onPatch([key], { sku: val })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          aria-label={`Barcode for ${name}`}
                          value={v.barcode}
                          onChange={(e) => onPatch([key], { barcode: e.target.value })}
                          onBlur={(e) => {
                            const t = e.target.value.trim();
                            if (t !== e.target.value) onPatch([key], { barcode: t });
                          }}
                          className={cn(
                            "input h-11 font-mono sm:h-9",
                            errorFor(key, "barcode") && "border-danger"
                          )}
                          placeholder="EAN / UPC"
                          autoComplete="off"
                          spellCheck={false}
                        />
                      </td>
                    </>
                  )}

                  {view === "stock" && (
                    <>
                      {tracked ? (
                        <TrackedStockCells facts={f} lowStockAt={entryNumber(v.lowStockAt) ?? lowStockDefault} />
                      ) : (
                        <td className="px-3 py-2">
                          {perCombination ? (
                            <input
                              type="number"
                              min={0}
                              aria-label={`Stock for ${name}`}
                              value={v.stock}
                              onChange={(e) => onPatch([key], { stock: e.target.value })}
                              className="input h-11 sm:h-9"
                              placeholder={`Product · ${baseStock || 0}`}
                              disabled={!v.available}
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground tabular-nums">
                              Product · {baseStock || 0}
                            </span>
                          )}
                        </td>
                      )}
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          aria-label={`Low-stock alert for ${name}`}
                          value={v.lowStockAt}
                          onChange={(e) => onPatch([key], { lowStockAt: e.target.value })}
                          className="input h-11 sm:h-9"
                          placeholder={`Store · ${lowStockDefault}`}
                        />
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>

      {error?.message && (
        <p
          role="alert"
          className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger"
        >
          {error.message}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          Showing {filteredKeys.length} of {combos.length}.
        </span>
        {view === "sku" && retired.length > 0 && (
          <span className="inline-flex flex-wrap items-center gap-1">
            Retired, kept for stock history:{" "}
            <span className="font-mono text-foreground">
              {retired.map((r) => r.sku).join(", ")}
            </span>
            <InfoTip term="Retired SKUs">
              A combination you removed from the options keeps its row and SKU
              when it has stock history, because the stock ledger has to be able
              to name it. Add the same choice back and it returns with its
              history. Its SKU cannot be given to another combination meanwhile.
            </InfoTip>
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Cells                                                              */
/* ------------------------------------------------------------------ */

function Th({
  label,
  tip,
  className,
}: {
  label: string;
  tip?: React.ReactNode;
  className?: string;
}) {
  return (
    <th scope="col" className={cn("px-3 py-2.5 font-medium", className)}>
      <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
        {label}
        {tip && <InfoTip term={label}>{tip}</InfoTip>}
      </span>
    </th>
  );
}

function RupeeInput({
  value,
  onChange,
  placeholder,
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  "aria-label": string;
}) {
  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
        ₹
      </span>
      <input
        type="number"
        min={0}
        inputMode="numeric"
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input h-11 pl-6 sm:h-9"
        placeholder={placeholder}
      />
    </div>
  );
}

function Margin({ price, cost }: { price: number; cost: number | null }) {
  if (cost == null) return <span className="text-muted-foreground">—</span>;
  const profit = price - cost;
  const pct = price > 0 ? Math.round((profit / price) * 100) : null;
  return (
    <span className={cn("tabular-nums", profit < 0 && "text-danger")}>
      <span className="font-medium">{formatINR(profit)}</span>
      {pct != null && <span className="block text-[11px] text-muted-foreground">{pct}%</span>}
    </span>
  );
}

/**
 * The SKU box. An existing SKU cannot be blanked — clearing it and leaving
 * puts the stored one back, because a combination without a SKU is not a
 * state the ledger can have. A new combination's box stays empty with the
 * generated SKU as its placeholder until the admin types one.
 */
export function SkuInput({
  id,
  name,
  value,
  existing,
  preview,
  duplicate,
  serverError,
  onChange,
}: {
  id?: string;
  name: string;
  value: string;
  existing: string | null;
  preview: string | null;
  duplicate: boolean;
  serverError: string | null;
  onChange: (v: string) => void;
}) {
  const normal = normaliseSku(value);
  const changed = normal !== "" && normal !== existing;
  const invalid = changed && !SKU_PATTERN.test(normal);
  const problem = invalid
    ? "3–40 capital letters, digits and hyphens"
    : duplicate
      ? "Another combination has this SKU"
      : null;

  return (
    <div className="min-w-0">
      <input
        id={id}
        aria-label={`SKU for ${name}`}
        aria-invalid={!!(problem || serverError) || undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          const next = normal || existing || "";
          if (next !== value) onChange(next);
        }}
        className={cn(
          "input h-11 font-mono uppercase sm:h-9",
          (problem || serverError) && "border-danger"
        )}
        placeholder={preview ? `${preview} · auto` : undefined}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
      />
      {(problem || serverError) && (
        <p className="mt-1 text-[11px] text-danger">{problem ?? "See the message below"}</p>
      )}
    </div>
  );
}

function TrackedStockCells({
  facts,
  lowStockAt,
}: {
  facts: VariantRowFacts | undefined;
  lowStockAt: number;
}) {
  if (!facts) {
    return (
      <>
        <td className="px-3 py-2 text-xs text-muted-foreground" colSpan={3}>
          Starts at 0 — receive stock in Inventory after saving.
        </td>
      </>
    );
  }
  const state = stockStateOf(facts, lowStockAt);
  const meta = STOCK_STATE_META[state];
  return (
    <>
      <td className="px-3 py-2">
        <span
          className={cn(
            "font-semibold tabular-nums",
            meta.tone === "danger" && "text-danger",
            meta.tone === "warning" && "text-orange-600 dark:text-orange-400"
          )}
        >
          {facts.available}
        </span>
        {state !== "ok" && (
          <span className="block text-[10px] uppercase tracking-widest text-muted-foreground">
            {meta.label}
          </span>
        )}
      </td>
      <td className="px-3 py-2 tabular-nums">{facts.onHand}</td>
      <td className="px-3 py-2 tabular-nums text-muted-foreground">{facts.reserved}</td>
    </>
  );
}
