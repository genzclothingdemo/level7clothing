"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { toast } from "sonner";
import { Loader2, Lock, Truck, CreditCard, Wallet } from "lucide-react";
import { useCart } from "@/context/cart";
import { useSettings } from "@/context/settings";
import { Button, ButtonLink } from "@/components/ui/button";
import { formatINR } from "@/lib/utils";
import {
  placeOrder,
  verifyRazorpayPayment,
  getCheckoutContext,
} from "@/app/actions/orders";
import { listMyAddresses, type SavedAddress } from "@/app/actions/addresses";
import {
  CheckoutAddressPicker,
  type ChosenAddress,
} from "@/components/store/checkout-address-picker";
import { InfoTip } from "@/components/store/info-tip";
import { VerifyContactPanel } from "@/components/store/auth-code-panel";
import type { PaymentMode } from "@/lib/types";

/**
 * The three modes checkout offers — **the only three**, and the client half of
 * `CHECKOUT_MODES` in `app/actions/orders.ts`.
 *
 * Two instruments underneath: cash, and online through Razorpay. Prepaid is
 * entirely online, COD is entirely cash, and partial is one of each — the
 * advance online, the remainder in cash at the door.
 *
 * "Direct" ("no online payment — arrange with us") was a fourth and has been
 * withdrawn. It is not in this list, it is not in `MODE_TO_METHOD`, and there
 * is no fallback that can reintroduce it: if nothing is available the page says
 * so, because dropping every order into a pay-the-owner request was the failure
 * this removal exists to end.
 */
const CHECKOUT_MODES = ["prepaid", "partial", "cod"] as const;

type CheckoutMode = (typeof CHECKOUT_MODES)[number];

/** The stored `Order.paymentMethod` label for each checkout mode. */
const MODE_TO_METHOD: Record<CheckoutMode, "Razorpay" | "COD" | "Partial"> = {
  prepaid: "Razorpay",
  cod: "COD",
  partial: "Partial",
};

type CheckoutContext = {
  methods: Record<CheckoutMode, boolean>;
  /** Cash-handling fees in whole rupees, 0 when the store absorbs them. */
  fees: { cod: number; partial: number };
  products: { id: string; paymentModes: PaymentMode[]; advancePercent: number | null }[];
};

// Razorpay Checkout is loaded on demand from their CDN.
type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description?: string;
  order_id: string;
  prefill?: { name?: string; email?: string; contact?: string };
  theme?: { color?: string };
  handler: (r: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }) => void;
  modal?: { ondismiss?: () => void };
};
type RazorpayInstance = { open: () => void };
declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(false);
    if (window.Razorpay) return resolve(true);
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export type CheckoutUser = {
  name: string;
  email: string;
  phone: string | null;
  /**
   * @deprecated Legacy inline `User` address columns. Still accepted so the
   * checkout page keeps compiling, but deliberately NOT read: the address
   * comes from the `Address` table via `listMyAddresses()`, which also folds
   * any leftover inline values into a real saved address on first load. See
   * the header comment in `src/app/actions/addresses.ts`.
   */
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
};

export function CheckoutClient({ user }: { user: CheckoutUser }) {
  const { items, subtotal, clear } = useCart();
  const s = useSettings();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const [couponCode, setCouponCode] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; discountAmount: number } | null>(null);
  const [couponError, setCouponError] = useState("");
  const [applyingCoupon, setApplyingCoupon] = useState(false);

  const [dynamicShippingFee, setDynamicShippingFee] = useState<number | null>(null);
  const [shippingLoading, setShippingLoading] = useState(false);
  const [shippingError, setShippingError] = useState("");


  // Payment rules for the cart, loaded from the server (authoritative).
  const [ctx, setCtx] = useState<CheckoutContext | null>(null);
  const [method, setMethod] = useState<CheckoutMode | null>(null);

  /**
   * Set when `placeOrder` stops for an unconfirmed contact.
   *
   * Nothing asks for this up front: the gate is off in most stores, and a
   * checkout that demanded a code before anyone had chosen how to pay would be
   * a worse checkout for the sake of a setting almost nobody turns on. It
   * appears only when the server actually refuses, and the refusal names the
   * channel and the masked target so this component never has to guess.
   */
  const [verify, setVerify] = useState<{
    channel: "email" | "sms";
    shown: string;
  } | null>(null);

  // Identity is seeded from the account; the delivery fields are filled by the
  // address picker below — never from `user.address`, which is the legacy
  // inline copy this change exists to retire.
  const [form, setForm] = useState({
    customerName: user.name ?? "",
    email: user.email ?? "",
    phone: user.phone ?? "",
    address: "",
    city: "",
    state: "",
    pincode: "",
    // The shopper's own note. Destined for `Order.buyerNote`, NOT `Order.note`
    // (which is the admin's private field) — see the comment on `placeOrder`
    // below.
    note: "",
  });

  /* ---------------- Saved addresses (the source of truth) ---------------- */
  // null = not signed in (guest). [] = signed in with an empty address book.
  const [addresses, setAddresses] = useState<SavedAddress[] | null>(null);
  const [addressesLoading, setAddressesLoading] = useState(true);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  // False while a signed-in customer is mid-way through typing a new address:
  // "Deliver here" is what saves it, so the order must not be placed around it.
  const [addressReady, setAddressReady] = useState(false);
  const [, startTransition] = useTransition();

  const applyAddress = useCallback(
    (a: ChosenAddress, savedId: string | null, ready = savedId !== null) => {
      setSelectedAddressId(savedId);
      setAddressReady(ready);
      setForm((f) => ({
        ...f,
        // The recipient's name and phone belong to the address, not the
        // account — a gift going to a friend has both different.
        customerName: a.fullName,
        phone: a.phone,
        address: a.address,
        city: a.city,
        state: a.state,
        pincode: a.pincode,
      }));
    },
    []
  );

  const refreshAddresses = useCallback(
    async (preferId?: string) => {
      // A failure degrades to the guest path on purpose: an unreachable
      // address book must never stop someone ordering — they get the plain
      // form and the order still carries a correct address.
      const rows = await listMyAddresses().catch(() => null);
      setAddresses(rows);
      setAddressesLoading(false);
      // Guest: no book to pick from, so the plain form governs and the
      // browser's own `required` validation is the only gate.
      if (rows === null) {
        setAddressReady(true);
        return;
      }
      if (rows.length === 0) return;
      const pick =
        (preferId ? rows.find((r) => r.id === preferId) : undefined) ??
        rows.find((r) => r.isDefault) ??
        rows[0];
      applyAddress(pick, pick.id);
    },
    [applyAddress]
  );

  // Next 16: a Server Action called from an effect has to be wrapped in
  // `startTransition` (see node_modules/next/dist/docs/01-app/02-guides/
  // server-actions.md). `refreshAddresses` is stable, so this runs once.
  useEffect(() => {
    startTransition(async () => {
      await refreshAddresses();
    });
  }, [refreshAddresses]);

  // If shipping is free globally via type, or if subtotal threshold is met
  const isFreeThreshold = s.freeShippingThreshold != null && subtotal >= s.freeShippingThreshold;
  
  let shipping = 0;
  if (!isFreeThreshold) {
    shipping = dynamicShippingFee ?? 0;
  }

  const discountTotal = appliedCoupon ? appliedCoupon.discountAmount : 0;

  /**
   * What the store charges for handling cash on this order.
   *
   * Shown as its own named line below rather than folded into the total: a
   * shopper who picks cash on delivery and watches the total move is owed the
   * word for why. Prepaid never carries one — there is no cash to collect — and
   * a store that absorbs the cost sets it to 0, which renders no line at all.
   */
  const paymentFee =
    method === "cod"
      ? (ctx?.fees.cod ?? 0)
      : method === "partial"
        ? (ctx?.fees.partial ?? 0)
        : 0;

  const total = Math.max(0, subtotal + shipping + paymentFee - discountTotal);

  // A stable signature of the cart's product ids so we only refetch on change.
  const idKey = items.map((i) => i.productId).sort().join(",");

  useEffect(() => {
    const ids = idKey ? idKey.split(",") : [];
    if (ids.length === 0) {
      setCtx(null);
      return;
    }
    let alive = true;
    getCheckoutContext(ids).then((res) => {
      if (alive) setCtx(res);
    });
    return () => {
      alive = false;
    };
  }, [idKey]);

  useEffect(() => {
    // We always calculate via API since the backend now handles per-product shipping rules (Free, Fixed, Nimbus).
    // If the cart has no nimbus products, the API will just return the fixed fee total immediately.

    if (!form.pincode || form.pincode.length < 6 || !method || items.length === 0) {
      setDynamicShippingFee(null);
      setShippingError("");
      return;
    }
    let alive = true;
    setShippingLoading(true);
    setShippingError("");

    fetch("/api/store/shipping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pincode: form.pincode,
        paymentType: method === "cod" ? "cod" : "prepaid",
        items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!alive) return;
        setShippingLoading(false);
        if (data.success) {
          setDynamicShippingFee(data.rate);
        } else {
          setDynamicShippingFee(null);
          setShippingError(data.error || "Shipping not available");
        }
      })
      .catch(() => {
        if (!alive) return;
        setShippingLoading(false);
        setDynamicShippingFee(null);
        setShippingError("Failed to calculate shipping");
      });

    return () => { alive = false; };
  }, [form.pincode, method, items]);

  /**
   * Modes offered = intersection of each product's modes, filtered by the
   * store-wide toggles. Mirrors `resolveAllowedModes` on the server, which is
   * the one that actually decides — this only chooses what to draw.
   *
   * An empty result stays empty. There is no "…or else direct" line any more:
   * a cart with nothing available says so and cannot be submitted, rather than
   * being silently converted into a request the shopper never asked for.
   */
  const allowedModes = useMemo<CheckoutMode[]>(() => {
    if (!ctx) return [];
    const byId = new Map(ctx.products.map((p) => [p.id, p]));
    return CHECKOUT_MODES.filter(
      (m) =>
        ctx.methods[m] &&
        items.every((i) => {
          const p = byId.get(i.productId);
          const list = p?.paymentModes?.length ? p.paymentModes : ["prepaid", "cod"];
          return list.includes(m);
        })
    );
  }, [ctx, items]);

  /** Loaded, and genuinely nothing on offer — not merely still loading. */
  const noMethods = !!ctx && allowedModes.length === 0;

  // Advance (partial) = sum of each line's advance% of its line total.
  const advance = useMemo(() => {
    if (!ctx) return 0;
    const byId = new Map(ctx.products.map((p) => [p.id, p]));
    let a = 0;
    for (const i of items) {
      const pct = byId.get(i.productId)?.advancePercent ?? 0;
      a += Math.round((i.price * i.quantity * pct) / 100);
    }
    return Math.min(Math.max(a, 0), total);
  }, [ctx, items, total]);

  // Keep the selected mode valid as the allowed set resolves/changes. An empty
  // set clears the selection rather than leaving a stale one behind — the
  // submit button reads `method`, so a leftover value would let an order be
  // sent in a mode the page has stopped offering.
  useEffect(() => {
    setMethod((cur) =>
      allowedModes.length === 0
        ? null
        : cur && allowedModes.includes(cur)
          ? cur
          : allowedModes[0]
    );
  }, [allowedModes]);

  const isOnline = method === "prepaid" || method === "partial";
  const balanceDue =
    method === "prepaid" ? 0 : method === "partial" ? total - advance : total;

  // Mirrors `placeOrder`'s own minimums, so the button can never submit an
  // order the server will reject.
  const hasDeliverableAddress =
    addressReady &&
    !addressesLoading &&
    form.customerName.trim().length >= 2 &&
    form.phone.trim().length >= 6 &&
    form.address.trim().length >= 4 &&
    form.city.trim().length >= 2 &&
    form.state.trim().length >= 2 &&
    form.pincode.trim().length >= 6;

  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  if (items.length === 0 && !loading) {
    return (
      <div className="container-px mx-auto max-w-2xl py-28 text-center">
        <h1 className="font-serif text-3xl">Your cart is empty</h1>
        <ButtonLink href="/shop" className="mt-8">
          Browse the shop
        </ButtonLink>
      </div>
    );
  }

  async function handleApplyCoupon() {
    if (!couponCode) return;
    setApplyingCoupon(true);
    setCouponError("");

    try {
      const res = await fetch("/api/store/coupons/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: couponCode, items }),
      });
      const data = await res.json();
      if (data.success) {
        setAppliedCoupon({ code: data.code, discountAmount: data.discountAmount });
        setCouponCode("");
        toast.success("Coupon applied!");
      } else {
        setCouponError(data.error);
      }
    } catch (err) {
      setCouponError("Failed to apply coupon");
    } finally {
      setApplyingCoupon(false);
    }
  }

  function handleRemoveCoupon() {
    setAppliedCoupon(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!method) return;
    setLoading(true);

    const visitorId =
      typeof window !== "undefined"
        ? localStorage.getItem("level7_vid") ?? undefined
        : undefined;

    const online = method === "prepaid" || method === "partial";

    // If paying online, make sure the Razorpay script is ready before we start.
    if (online) {
      const ok = await loadRazorpayScript();
      if (!ok) {
        setLoading(false);
        toast.error("Couldn't load the payment window. Check your connection.");
        return;
      }
    }

    // ORDER NOTES — this text belongs in `Order.buyerNote`, not `Order.note`.
    //
    // `Order.note` is the ADMIN's private field: checkout writes the shopper's
    // text there and the admin's own note then overwrites it, which is why
    // `note` can never be shown to anyone safely. The schema already has three
    // separate columns for the three directions — buyerNote (them → us),
    // customerNote (us → them), note (internal).
    //
    // The destination cannot be changed from here: `placeOrder`'s zod schema
    // in `src/app/actions/orders.ts` accepts `note` and nothing else, and zod
    // strips unknown keys, so sending `buyerNote` would be silently dropped.
    // That file is outside this change's scope. The two-line patch it needs is
    // in the handover notes; until it lands, this keeps behaving exactly as it
    // did before, with no regression.
    const res = await placeOrder({
      ...form,
      paymentMethod: MODE_TO_METHOD[method],
      visitorId,
      couponCode: appliedCoupon?.code,
      items: items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        note: i.note,
        options: i.options,
      })),
    });

    if (!res.ok) {
      setLoading(false);
      if ("requiresLogin" in res && res.requiresLogin) {
        toast.error("Please log in to confirm your order.");
        router.push("/account/login?next=/checkout");
        return;
      }
      // The store wants this contact confirmed first. A panel appears above the
      // button with the code exchange in it — the basket, the address and the
      // chosen payment method are all untouched, so placing the order after
      // confirming is one more press of the same button.
      if ("requiresVerification" in res && res.requiresVerification) {
        setVerify(res.requiresVerification);
        toast.error(res.error || "Please confirm your contact details.");
        return;
      }
      toast.error(res.error || "Something went wrong");
      return;
    }

    // Cash on delivery — nothing to charge now, so no payment window.
    if (!("payment" in res) || !res.payment) {
      clear();
      toast.success("Order placed!");
      router.push(`/order/${res.orderNumber}`);
      return;
    }

    // Online (prepaid / partial) — open Razorpay, then verify server-side.
    const pay = res.payment;
    const orderNumber = res.orderNumber;

    if (!window.Razorpay) {
      setLoading(false);
      toast.error("Payment window unavailable. Please try again.");
      return;
    }

    const rzp = new window.Razorpay({
      key: pay.keyId,
      amount: pay.amount,
      currency: pay.currency,
      name: pay.name,
      description: `Order ${orderNumber}`,
      order_id: pay.orderId,
      prefill: pay.prefill,
      theme: { color: "#b08d4c" },
      handler: async (r) => {
        const verify = await verifyRazorpayPayment({
          orderNumber,
          razorpayOrderId: r.razorpay_order_id,
          razorpayPaymentId: r.razorpay_payment_id,
          razorpaySignature: r.razorpay_signature,
        });
        if (verify.ok) {
          clear();
          toast.success("Payment successful!");
          router.push(`/order/${orderNumber}`);
        } else {
          setLoading(false);
          toast.error(
            verify.error ||
              "We couldn't confirm your payment. If money was deducted, contact us."
          );
        }
      },
      modal: {
        ondismiss: () => {
          setLoading(false);
          toast("Payment cancelled — your order is saved and unpaid.", {
            description: "You can pay later or contact us to complete it.",
          });
        },
      },
    });
    rzp.open();
  }

  // Presentation details for each offered mode.
  const MODE_UI: Record<
    CheckoutMode,
    { label: string; desc: string; icon: React.ReactNode }
  > = {
    // Labels must match product-notices.tsx word for word — a shopper who read
    // "Part now, rest on delivery" on the product page should find that exact
    // option here, not "Advance Payment".
    prepaid: {
      label: "Pay online",
      desc: "UPI, cards, netbanking and wallets — secured by Razorpay.",
      icon: <CreditCard className="h-4 w-4 text-muted-foreground" />,
    },
    partial: {
      label: "Part now, rest on delivery",
      desc: `Pay ${formatINR(advance)} online now, then ${formatINR(
        Math.max(0, total - advance)
      )} in cash when it arrives. The advance is non-refundable.`,
      icon: <Wallet className="h-4 w-4 text-muted-foreground" />,
    },
    cod: {
      label: "Cash on delivery",
      desc: "Pay the courier in full when your order arrives.",
      icon: <Truck className="h-4 w-4 text-muted-foreground" />,
    },
  };

  /** The fee's own name, so the summary line is never just "Fee". */
  const FEE_LABEL: Record<CheckoutMode, string> = {
    prepaid: "",
    partial: "Part-payment handling",
    cod: "Cash on delivery handling",
  };

  const buttonLabel = !method
    ? ctx
      ? "Unavailable"
      : "Loading…"
    : method === "prepaid"
      ? `Pay ${formatINR(total)}`
      : method === "partial"
        ? `Pay ${formatINR(advance)} now`
        : `Place order · ${formatINR(total)}`;

  return (
    <div className="container-px mx-auto max-w-6xl py-12">
      <h1 className="font-serif text-4xl">Checkout</h1>

      <form
        onSubmit={onSubmit}
        className="mt-10 grid gap-10 lg:grid-cols-[1fr_380px]"
      >
        <div className="space-y-8">
          <section>
            <h2 className="font-serif text-xl">Contact</h2>
            <div className="mt-4">
              {/* Email only. The recipient's name and phone belong to the
                  delivery address below, so they are edited there — keeping a
                  second editable copy here is what let the two disagree. */}
              <Field label="Email" required>
                <input
                  required
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  className="input"
                />
              </Field>
              <p className="mt-2 text-xs text-muted-foreground">
                Your order confirmation and tracking updates go here.
              </p>
            </div>
          </section>

          <section>
            <h2 className="font-serif text-xl">Delivery address</h2>
            <div className="mt-4">
              <CheckoutAddressPicker
                addresses={addresses}
                loading={addressesLoading}
                selectedId={selectedAddressId}
                onChoose={applyAddress}
                onBookChanged={(id) => refreshAddresses(id)}
                disabled={loading}
              />
            </div>
          </section>

          <section>
            <h2 className="font-serif text-xl">
              Order notes
              <InfoTip term="Order notes">
                Anything we should know while packing — a landmark for the
                courier, a gift message, or personalisation details. It reaches
                our packing team, not the courier&apos;s app.
              </InfoTip>
            </h2>
            <div className="mt-4">
              <Field label="Notes (optional)">
                <textarea
                  value={form.note}
                  onChange={(e) => set("note", e.target.value)}
                  rows={3}
                  className="input resize-none"
                  placeholder="Personalisation details, delivery instructions…"
                />
              </Field>
            </div>
          </section>

          <section>
            <h2 className="font-serif text-xl">Payment</h2>
            {!ctx ? (
              <div className="mt-4 flex items-center gap-2 rounded-2xl border border-border p-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading payment
                options…
              </div>
            ) : noMethods ? (
              // Stated, never silently replaced. The old fallback dropped this
              // case into "arrange with us", so a store with every method off
              // kept taking orders nobody had agreed terms for.
              <div className="mt-4 rounded-2xl border border-danger/40 bg-danger/5 p-4 text-sm">
                <p className="font-medium">
                  We can&apos;t take payment for this basket right now.
                </p>
                <p className="mt-1 text-muted-foreground">
                  None of our payment options covers every item in it. Message us
                  and we&apos;ll sort it out — or remove an item and try again.
                </p>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {allowedModes.map((m) => {
                  const ui = MODE_UI[m];
                  return (
                    <label
                      key={m}
                      className={`flex items-center gap-3 rounded-2xl border p-4 cursor-pointer transition-colors ${
                        method === m
                          ? "border-foreground bg-muted/40"
                          : "border-border"
                      }`}
                    >
                      <input
                        type="radio"
                        name="payment"
                        checked={method === m}
                        onChange={() => setMethod(m)}
                        className="accent-[var(--accent)]"
                      />
                      <span className="text-sm">
                        {ui.label}
                        <span className="block text-xs text-muted-foreground">
                          {ui.desc}
                        </span>
                      </span>
                      <span className="ml-auto">{ui.icon}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <aside className="h-fit rounded-2xl border border-border bg-card p-6 lg:sticky lg:top-24">
          <h2 className="font-serif text-xl">Your order</h2>
          <ul className="mt-4 space-y-3">
            {items.map((i) => (
              <li key={i.productId} className="flex gap-3">
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-muted">
                  {i.image && (
                    <Image
                      src={i.image}
                      alt={i.name}
                      fill
                      sizes="56px"
                      className="object-cover"
                    />
                  )}
                </div>
                <div className="flex flex-1 flex-col text-sm">
                  <span className="line-clamp-1">{i.name}</span>
                  {i.options && i.options.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {i.options.map((o) => o.value).join(" · ")}
                    </span>
                  )}
                  <span className="text-muted-foreground">Qty {i.quantity}</span>
                </div>
                <span className="text-sm font-medium">
                  {formatINR(i.price * i.quantity)}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-5 space-y-3 border-t border-border pt-4">
            {/* Coupon Code Section */}
            {!appliedCoupon ? (
              <div>
                {/* `min-w-0` is what stops the overflow: an input's default
                    `min-width:auto` resolves to its intrinsic size (~200px),
                    which with a non-shrinking Apply button exceeded the 232px
                    available inside the summary card at 320px. */}
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={couponCode}
                    onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                    placeholder="Discount code"
                    className="input w-full min-w-0 uppercase"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleApplyCoupon}
                    disabled={applyingCoupon || !couponCode}
                    className="shrink-0"
                  >
                    {applyingCoupon ? "..." : "Apply"}
                  </Button>
                </div>
                {couponError && (
                  <p className="mt-1 text-xs text-danger">{couponError}</p>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-lg bg-muted/50 p-2 text-sm">
                <span className="font-medium font-mono">{appliedCoupon.code}</span>
                <button
                  type="button"
                  onClick={handleRemoveCoupon}
                  className="text-xs text-danger hover:underline"
                >
                  Remove
                </button>
              </div>
            )}
          </div>

          <div className="mt-5 space-y-2 border-t border-border pt-4 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatINR(subtotal)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground flex gap-2 items-center">
                Shipping {shippingLoading && <Loader2 className="h-3 w-3 animate-spin" />}
              </span>
              <span>{shippingLoading ? "Calculating..." : shipping === 0 ? "Free" : formatINR(shipping)}</span>
            </div>
            {shippingError && (
              <div className="flex justify-between text-danger">
                <span className="text-xs">Error</span>
                <span className="text-xs">{shippingError}</span>
              </div>
            )}
            {/* The cash-handling fee, named and on its own line. Rendered only
                when there is one: a "₹0 handling" row is noise, and the store
                absorbing the cost is the default. */}
            {method && paymentFee > 0 && (
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 text-muted-foreground">
                  {FEE_LABEL[method]}
                  <InfoTip term={FEE_LABEL[method]}>
                    Collecting cash at the door costs us a courier collection
                    charge, so we pass on a flat {formatINR(paymentFee)}. Paying
                    online in full has no such fee.
                  </InfoTip>
                </span>
                <span>{formatINR(paymentFee)}</span>
              </div>
            )}
            {appliedCoupon && (
              <div className="flex justify-between text-success">
                <span>Discount ({appliedCoupon.code})</span>
                <span>-{formatINR(appliedCoupon.discountAmount)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-border pt-2 text-base font-medium">
              <span>Total</span>
              <span>{formatINR(total)}</span>
            </div>

            {/* Payment split — shown for partial (advance) and any COD balance. */}
            {method === "partial" && (
              <div className="mt-1 space-y-1 rounded-xl bg-muted/50 p-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Pay now (advance)</span>
                  <span className="font-medium">{formatINR(advance)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Due on delivery</span>
                  <span className="font-medium">{formatINR(balanceDue)}</span>
                </div>
                <p className="pt-1 text-muted-foreground">
                  The advance amount is non-refundable.
                </p>
              </div>
            )}
            {method === "cod" && (
              <p className="text-xs text-muted-foreground">
                Pay {formatINR(total)} in cash on delivery.
              </p>
            )}
          </div>

          {/* ---- The store wants this contact confirmed first ----
              Above the button, not in a dialog: the basket and the total stay
              on screen, so it reads as one more step rather than as the order
              having failed. Confirming stamps the account, and the same button
              underneath then places the order. */}
          {verify && (
            <div className="mt-6">
              <VerifyContactPanel
                channel={verify.channel}
                heading={
                  verify.channel === "sms"
                    ? "Confirm your mobile number"
                    : "Confirm your email address"
                }
                reason="This store asks for a confirmed contact before an order goes through. One code and you're done — your basket is safe."
                shown={verify.shown}
                /*
                 * Deliberately NOT `setVerify(null)`.
                 *
                 * Clearing it unmounts the panel the instant the code is
                 * accepted, so the only thing left is a toast that has already
                 * started fading — and the shopper is looking at a button that
                 * refused them ten seconds ago with nothing on screen saying
                 * that has changed. The panel keeps its own "confirmed" state
                 * and says so in green above the button. Nothing needs
                 * clearing: the account is stamped, so the next press is not
                 * refused, and a placed order navigates away.
                 */
                onVerified={() => {}}
              />
            </div>
          )}

          {/* A saved address can be picked without touching a single input, so
              native `required` no longer guards the submit — check the fields
              the order actually needs. */}
          <Button
            type="submit"
            disabled={
              loading ||
              !method ||
              shippingLoading ||
              !!shippingError ||
              !hasDeliverableAddress
            }
            className="mt-6 w-full"
            size="lg"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />{" "}
                {isOnline ? "Starting payment…" : "Placing order…"}
              </>
            ) : (
              buttonLabel
            )}
          </Button>
          {/* Never leave a disabled button unexplained. */}
          {!hasDeliverableAddress && !addressesLoading && (
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Confirm a delivery address to continue.
            </p>
          )}
          <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5" /> Your details are safe with us
          </p>
        </aside>
      </form>
    </div>
  );
}

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="mb-1.5 block text-sm text-muted-foreground">
        {label}
        {required && <span className="text-danger"> *</span>}
      </span>
      {children}
    </label>
  );
}
