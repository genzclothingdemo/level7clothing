/**
 * The inventory vocabulary, shared by the engine (`lib/inventory.ts`) and every
 * screen that shows stock.
 *
 * **No directive and no server imports**, so client components can read it —
 * see CLAUDE.md, "RSC boundary traps". The engine that *writes* stock is
 * server-only and lives next door.
 */

/**
 * Every way stock can change. Each one is a row in `StockMovement`, and the
 * three counters on `ProductVariant` are always the running sum of these rows.
 *
 * | type           | onHand | reserved | who             |
 * |----------------|--------|----------|-----------------|
 * | OPENING        |   +    |          | stocktake       |
 * | RECEIPT        |   +    |          | admin           |
 * | RESERVE        |        |    +     | order placed    |
 * | RELEASE        |        |    −     | order cancelled |
 * | SALE           |   −    |    −     | order shipped   |
 * | RETURN         |   +    |          | return received |
 * | RTO            |   +    |          | parcel came back|
 * | DAMAGE         |   −    |          | admin           |
 * | PERSONAL_USE   |   −    |          | admin           |
 * | ADJUSTMENT     |   ±    |          | admin recount   |
 */
export const MOVEMENT_TYPES = [
  "OPENING",
  "RECEIPT",
  "RESERVE",
  "RELEASE",
  "SALE",
  "RETURN",
  "RTO",
  "DAMAGE",
  "PERSONAL_USE",
  "ADJUSTMENT",
] as const;

export type MovementType = (typeof MOVEMENT_TYPES)[number];

/**
 * The four a person records by hand. Everything else is written by the order
 * and return lifecycle, and **refused if a person tries** — a hand-typed SALE
 * would be a sale with no order behind it, which is exactly the entry an
 * inventory audit exists to catch.
 */
export const MANUAL_MOVEMENT_TYPES = ["RECEIPT", "DAMAGE", "PERSONAL_USE", "ADJUSTMENT"] as const;

export type ManualMovementType = (typeof MANUAL_MOVEMENT_TYPES)[number];

export function isManualMovementType(v: unknown): v is ManualMovementType {
  return typeof v === "string" && (MANUAL_MOVEMENT_TYPES as readonly string[]).includes(v);
}

export function isMovementType(v: unknown): v is MovementType {
  return typeof v === "string" && (MOVEMENT_TYPES as readonly string[]).includes(v);
}

export type MovementMeta = {
  /** Short, for a table cell. */
  label: string;
  /** One line for the "what is this" tooltip. */
  description: string;
  /** Which way the shelf moves. `reserve` / `release` touch promises, not units. */
  direction: "in" | "out" | "reserve" | "release" | "either";
  /** A write-off or correction must say why; a delivery arriving need not. */
  requiresNote: boolean;
};

export const MOVEMENT_META: Record<MovementType, MovementMeta> = {
  OPENING: {
    label: "Opening count",
    description: "The first count, when this product started being tracked.",
    direction: "in",
    requiresNote: false,
  },
  RECEIPT: {
    label: "Stock in",
    description: "Fresh stock arrived.",
    direction: "in",
    requiresNote: false,
  },
  RESERVE: {
    label: "Reserved",
    description: "An order was placed. The unit is still on the shelf, but it is promised.",
    direction: "reserve",
    requiresNote: false,
  },
  RELEASE: {
    label: "Released",
    description: "The order was cancelled before it shipped, so the unit is free again.",
    direction: "release",
    requiresNote: false,
  },
  SALE: {
    label: "Shipped",
    description: "The order left the store. The unit is gone.",
    direction: "out",
    requiresNote: false,
  },
  RETURN: {
    label: "Returned",
    description: "A customer return came back in sellable condition.",
    direction: "in",
    requiresNote: false,
  },
  RTO: {
    label: "Came back (RTO)",
    description: "Delivery failed and the parcel returned to the store.",
    direction: "in",
    requiresNote: false,
  },
  DAMAGE: {
    label: "Damaged",
    description: "Dead stock — written off and removed from what can be sold.",
    direction: "out",
    requiresNote: true,
  },
  PERSONAL_USE: {
    label: "Personal use",
    description: "Taken for the store's own use — samples, shoots, gifts.",
    direction: "out",
    requiresNote: true,
  },
  ADJUSTMENT: {
    label: "Recount",
    description: "A physical count found a different number from the record.",
    direction: "either",
    requiresNote: true,
  },
};

/** What one variant's stock looks like right now. */
export type StockLevel = {
  onHand: number;
  reserved: number;
  available: number;
};

/**
 * - `oversold` — more is promised than is on the shelf. Some open orders cannot
 *   be filled from stock. This is the state that needs a person.
 * - `out` — nothing left to sell.
 * - `low` — at or under the threshold.
 * - `ok`
 */
export type StockState = "oversold" | "out" | "low" | "ok";

export function stockStateOf(level: StockLevel, lowStockAt: number): StockState {
  if (level.available < 0) return "oversold";
  if (level.available === 0) return "out";
  if (level.available <= lowStockAt) return "low";
  return "ok";
}

export const STOCK_STATE_META: Record<StockState, { label: string; tone: "danger" | "warning" | "muted" | "ok" }> = {
  oversold: { label: "Oversold", tone: "danger" },
  out: { label: "Out of stock", tone: "danger" },
  low: { label: "Low stock", tone: "warning" },
  ok: { label: "In stock", tone: "ok" },
};

/** Who made a change. The name is copied onto the row so it survives the person. */
export type StockActor = {
  type: "admin" | "temp_admin" | "system";
  id?: string | null;
  name?: string | null;
};

export const SYSTEM_ACTOR: StockActor = { type: "system", name: "Store" };
