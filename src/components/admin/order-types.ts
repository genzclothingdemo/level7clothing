/**
 * Shapes shared by the Admin → Orders screen.
 *
 * They live here rather than in `orders-table.tsx` so the table and the
 * tracking panel can both import them without importing each other.
 * `orders-table.tsx` re-exports `AdminOrder`, which is what the page imports.
 */

/** One entry of `Order.statusHistory`. */
export type StatusEntry = {
  status: string;
  note?: string;
  at: string;
  /**
   * True only for notes the admin deliberately wrote **for the customer**.
   * Everything else in the history is internal — NimbusPost draft/AWB chatter,
   * courier scans, "cancelled by admin" — and must never reach the storefront.
   */
  forCustomer?: boolean;
};

export type AdminOrderItem = {
  /** Present on orders placed after line items started recording it. */
  productId?: string;
  /** Resolved server-side; null when the product has since been deleted. */
  slug?: string | null;
  name: string;
  quantity: number;
  price: number;
  options?: { name: string; value: string }[];
  /** From the live catalogue: this piece is made to order. */
  isCustomisable?: boolean;
  /** What the customer has to supply for it (name, number, measurements…). */
  customisationNote?: string | null;
  /** Anything the customer typed against this line at checkout. */
  note?: string;
};

export type AdminOrder = {
  id: string;
  orderNumber: string;
  customerName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  items: AdminOrderItem[];
  subtotal: number;
  shipping: number;
  discountTotal?: number;
  couponCode?: string | null;
  total: number;
  amountPaid: number;
  balanceDue: number;
  paymentMethod: string;
  paymentStatus: string;
  status: string;
  courier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  nimbusShipmentId: string | null;
  nimbusCourierId: string | null;
  nimbusCourierName: string | null;
  deliveryStatus: string | null;
  deliveryLocation: string | null;
  deliveryStatusAt: string | null;
  lastSyncedAt: string | null;
  /** Internal note. Never shown to the customer. */
  note: string | null;
  /** The message the customer sees on their order page. */
  customerNote: string | null;
  /** Set at checkout when any line item is a made-to-order product. */
  needsCustomisation: boolean;
  statusHistory: StatusEntry[];
  createdAt: string;
  /** How many return requests this order has. */
  returnCount: number;
};

export type CourierOption = {
  courierId: string;
  name: string;
  type: string | null;
  tatDays: number | null;
  chargeableGrams: number | null;
  total: number;
  forward: number;
  rto: number;
  cod: number;
  surcharges: number;
};
