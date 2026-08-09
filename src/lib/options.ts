import type { Attribute } from "./types";

/** Stable key for a combination map, e.g. { Size:"S", Type:"A" } → "Size=S|Type=A". */
export function comboKey(combo: Record<string, string>): string {
  return Object.keys(combo)
    .sort((a, b) => a.localeCompare(b))
    .map((k) => `${k}=${combo[k]}`)
    .join("|");
}

/**
 * Every full combination of the given attributes (cartesian product).
 * Returns combos as ordered maps { attributeName: value }.
 */
export function allCombinations(
  attributes: Attribute[]
): Record<string, string>[] {
  const groups = attributes.filter((g) => g.name && g.values.length > 0);
  if (groups.length === 0) return [];
  let combos: Record<string, string>[] = [{}];
  for (const g of groups) {
    const next: Record<string, string>[] = [];
    for (const base of combos) {
      for (const val of g.values) {
        if (!val) continue;
        next.push({ ...base, [g.name]: val });
      }
    }
    combos = next;
  }
  return combos;
}

/** Stable signature of a set of selected options (order-independent). */
export function optionSignature(options?: { name: string; value: string }[]): string {
  if (!options || options.length === 0) return "";
  return [...options]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((o) => `${o.name}=${o.value}`)
    .join("|");
}

/** A cart line is unique per product + selected option combination. */
export function makeLineId(productId: string, options?: { name: string; value: string }[]): string {
  const sig = optionSignature(options);
  return sig ? `${productId}::${sig}` : productId;
}
