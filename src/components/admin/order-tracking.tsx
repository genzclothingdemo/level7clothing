"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  FileText,
  Loader2,
  Lock,
  MapPin,
  PackageCheck,
  RefreshCw,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import { cn, formatINR } from "@/lib/utils";
import { InfoTip } from "@/components/store/info-tip";
import { CopyableId } from "@/components/admin/copy-id";
import { Badge, Btn, BtnLink, LabelledField } from "@/components/admin/order-ui";
import type { AdminOrder, CourierOption } from "@/components/admin/order-types";
import { adminOrderState, shipmentGateFor } from "@/lib/orders-pipeline";
import type { Collection } from "@/lib/orders-pipeline";
import {
  autoSyncOrderAction,
  cancelOrderDraftAction,
  chooseCourierAction,
  draftOrderInNimbusAction,
  getCourierOptionsAction,
  shipOrderNowAction,
  syncOrderFromNimbusAction,
  updateOrderTracking,
} from "@/app/actions/admin";

/**
 * The shipment half of an order.
 *
 * ## One gate decides what is on screen
 *
 * `shipmentGateFor()` (pure, in `lib/orders-pipeline.ts`, and the same function
 * the server actions enforce) answers *what may this order do with the courier
 * right now*, and this panel draws its `can` flags — it never re-derives the
 * rule from `order.status` or `order.trackingNumber` itself. That is the whole
 * point: the button offered and the rule applied are one object.
 *
 * | gate     | what is on screen                                        |
 * |----------|----------------------------------------------------------|
 * | `booked` | tracking only: courier, AWB, link, last scan, Sync        |
 * | `pending`| one line — confirm the order first                        |
 * | `closed` | one line — cancelled / payment failed                     |
 * | `done`   | one line — delivered, nothing left to ship                |
 * | `ready`  | **Choose courier** (draft or book) · **Send draft**       |
 * | `staged` | **Choose courier** (book) · Sync · cancel draft           |
 *
 * The owner's complaint, verbatim: *"if order status pending/cancel, delivered
 * hai to nimbus ka option show hi kyu kare? if AWB order draft or book ho gaya
 * hai then us button ko hide karde."* Four of those six rows exist to answer
 * it — a state with nothing to do shows one sentence, not a row of controls
 * that will be refused.
 *
 * The one control that survives a dead state is **cancel draft**, and only when
 * a draft really is staged. It cannot put anything on a courier; it withdraws
 * something that is already there. A draft abandoned on a cancelled order is
 * money waiting to be spent by whoever reviews the NimbusPost list next.
 */
export function OrderTracking({ order }: { order: AdminOrder }) {
  const gate = shipmentGateFor(order);

  return (
    <div className="space-y-1.5">
      <AdminStateLine order={order} />
      {gate.can.tracking ? (
        <BookedShipment order={order} canSync={gate.can.sync} />
      ) : gate.allowed ? (
        <ShipmentActions order={order} gate={gate} />
      ) : (
        <ShipmentBlocked
          order={order}
          code={gate.code}
          reason={gate.reason}
          canCancelDraft={gate.can.cancelDraft}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  The operator's sentence                                            */
/* ------------------------------------------------------------------ */

/**
 * *"order confirmed: waiting for NimbusPost" / "draft done, waiting for
 * confirm" / "AWB booked, waiting for pickup"* — the owner's words, and the
 * reason this line exists.
 *
 * `Order.status` alone cannot say any of those: `confirmed` covers both
 * "nothing has been staged" and "a draft is waiting for you", and `shipped`
 * covers both "an AWB exists and the parcel is still on the shelf" and "it is
 * out for delivery". `adminOrderState()` composes the stored status with the
 * shipment stage (from `shipmentGateFor`) and the courier's last scan (from
 * `courierPhase`) — **one stored status, two vocabularies**; the customer's
 * coarser one is `customerOrderState` in `components/store/order-status.ts`.
 *
 * Both vocabularies read the same row of the same table in
 * `lib/nimbus-status.ts`, which is the rule: never a second courier map.
 */
function AdminStateLine({ order }: { order: AdminOrder }) {
  const state = adminOrderState(order);
  return (
    <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs">
      <Badge tone={state.tone}>{state.headline}</Badge>
      <span className="min-w-0 text-muted-foreground">{state.detail}</span>
      <InfoTip term="What this line means">
        Your order&apos;s status and where its parcel has got to, in one
        sentence. The customer sees the same journey in plainer words — they are
        never told about drafts, AWBs or your wallet, only whether the parcel is
        being packed, waiting for pickup, on its way or delivered.
      </InfoTip>
    </p>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared: withdraw a staged draft                                    */
/* ------------------------------------------------------------------ */

/**
 * The undo for "Send draft".
 *
 * Confirmed first, because it deletes something in NimbusPost — but not warned
 * about, because a draft costs nothing and leaving one behind is the more
 * expensive mistake.
 */
function CancelDraftButton({
  order,
  tone = "ghost",
}: {
  order: AdminOrder;
  tone?: "ghost" | "outline";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function run() {
    if (
      !confirm(
        `Withdraw the unbooked draft for ${order.orderNumber} from NimbusPost?\n\nNothing has been charged for it, and you can send a new draft afterwards.`
      )
    ) {
      return;
    }
    start(async () => {
      const res = await cancelOrderDraftAction(order.id);
      if (!res.ok) {
        toast.error(res.error, { duration: 10000 });
        return;
      }
      toast.success(
        res.cancelled
          ? "Draft withdrawn from NimbusPost."
          : "There was no draft left to withdraw."
      );
      router.refresh();
    });
  }

  return (
    <Btn
      tone={tone}
      onClick={run}
      disabled={pending}
      title="Delete the unbooked draft in NimbusPost and unlink it from this order"
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
      )}
      Cancel draft
    </Btn>
  );
}

/* ------------------------------------------------------------------ */
/*  1. Blocked — pending, cancelled, payment failed, delivered          */
/* ------------------------------------------------------------------ */

/**
 * One sentence, no shipping controls.
 *
 * A disabled button is a worse answer than a sentence: it still reads as
 * "ship this", it gives no reason, and on a phone it is a 44px target that
 * does nothing. So the whole shipment UI is simply absent here.
 */
function ShipmentBlocked({
  order,
  code,
  reason,
  canCancelDraft,
}: {
  order: AdminOrder;
  code: "pending" | "closed" | "done" | "ready" | "staged" | "booked";
  reason: string;
  canCancelDraft: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border border-border bg-muted/30 px-2.5 py-2">
      <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <p className="min-w-0 flex-1 text-xs text-muted-foreground">
        {reason}
        <InfoTip term="Why there is nothing to press">
          {code === "pending" ? (
            <>
              Confirming is the point an order stops being a request and becomes
              work. Use <b>Confirm order</b> above; the shipping controls appear
              here the moment it is confirmed.
            </>
          ) : code === "done" ? (
            <>
              This order has already arrived, so there is no forward leg left to
              book. A parcel coming back is a <b>return</b>, handled in Admin →
              Returns, not a second shipment on this order.
            </>
          ) : (
            <>
              Nothing can be sent to the courier for an order that was cancelled
              or whose payment failed. If this one really is going out, move it
              back to <b>Confirmed</b> with the status control above first.
            </>
          )}
        </InfoTip>
      </p>

      {canCancelDraft && (
        <>
          <Badge
            tone="info"
            title="An unbooked draft was staged before this order reached its current state. It is still sitting in NimbusPost."
          >
            <FileText className="h-2.5 w-2.5" aria-hidden /> Draft still staged
          </Badge>
          <CancelDraftButton order={order} />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  2. Booked — tracking only                                          */
/* ------------------------------------------------------------------ */

/**
 * What an already-shipped parcel shows: courier, AWB, tracking link, the latest
 * scan, and Sync. **No booking controls at all** — this is the requirement the
 * old panel broke, and the reason is money: a second booking is a second AWB,
 * a second parcel and a second charge against one order.
 */
function BookedShipment({
  order,
  canSync,
}: {
  order: AdminOrder;
  canSync: boolean;
}) {
  const router = useRouter();
  const [syncing, startSync] = useTransition();
  const [editing, setEditing] = useState(false);

  const awb = order.trackingNumber ?? "";

  // ---- Auto-sync ----------------------------------------------------------
  //
  // *"auto sync enable kar sakte hai kya? if AWB order create ho jaae then auto
  // sync ho jaae"*. Opening an order asks NimbusPost where the parcel is, so
  // nobody has to press Sync to find out.
  //
  // Three things keep it cheap. It only mounts inside an **expanded** order
  // row, so it is one call when a human looks at one order — not 25 per page
  // load. It only runs when there is an AWB to ask about. And the server action
  // is rate-limited against `lastSyncedAt`, so re-expanding the same row within
  // the window costs one indexed read and no NimbusPost call.
  //
  // The ref guard is for React's development double-invoke, not correctness:
  // a second call would be refused by the rate limit anyway.
  const orderId = order.id;
  const asked = useRef(false);
  useEffect(() => {
    if (!awb || asked.current) return;
    asked.current = true;
    let cancelled = false;
    autoSyncOrderAction(orderId)
      .then((res) => {
        // Refresh only when something actually moved. A silent poll that
        // re-rendered the table every time it found nothing would fight the
        // operator for their scroll position.
        if (!cancelled && res.ok && res.changed) router.refresh();
      })
      .catch(() => {
        // A courier outage must not break the panel. Sync is still there, and
        // it reports its own errors loudly.
      });
    return () => {
      cancelled = true;
    };
  }, [orderId, awb, router]);

  function sync() {
    startSync(async () => {
      const res = await syncOrderFromNimbusAction(order.id);
      if (!res.ok) {
        toast.error(res.error || "Could not sync", { duration: 8000 });
        return;
      }
      if (res.outcome === "tracked") {
        toast.success(
          res.deliveryStatus
            ? `Courier says: ${res.deliveryStatus}`
            : "No new scan from the courier yet."
        );
      } else if (res.outcome === "not-booked") {
        toast.info(`NimbusPost still reports this as ${res.orderStatus}.`);
      } else {
        toast.success(`Synced — AWB ${res.awb}`);
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-1.5">
      {/* ---- The shipment, read-only. One row, because that is all it is. ---- */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-accent/40 bg-accent/5 px-2.5 py-1.5 text-xs">
        <PackageCheck className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
        <span className="font-medium">
          Booked{order.courier ? ` · ${order.courier}` : ""}
        </span>
        <CopyableId id={awb} label="AWB" />
        <InfoTip term="Booked">
          This parcel has an AWB, so it exists with the courier. Booking
          controls are hidden on purpose — booking again would create a second
          shipment and charge your NimbusPost wallet twice for one order.
        </InfoTip>

        {order.trackingUrl && (
          <BtnLink
            href={order.trackingUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto px-2"
            title="Open the courier's tracking page"
          >
            <ExternalLink className="h-3 w-3" aria-hidden /> Track
          </BtnLink>
        )}
      </div>

      {/* ---- Latest scan ---- */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-xs">
        <span className="font-medium">
          {order.deliveryStatus ?? "Awaiting first scan"}
        </span>
        {order.deliveryLocation && (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <MapPin className="h-3 w-3" aria-hidden /> {order.deliveryLocation}
          </span>
        )}
        {order.deliveryStatusAt && (
          <span className="text-muted-foreground tabular-nums">
            {new Date(order.deliveryStatusAt).toLocaleString("en-IN")}
          </span>
        )}
        <InfoTip term="Courier scans">
          This updates itself three ways, so you should rarely need the button:
          NimbusPost pushes a webhook the moment a scan happens, a scheduled job
          sweeps every open shipment, and <b>opening this order re-checks it</b>{" "}
          if it has not been checked in the last 15 minutes. <b>Sync</b> asks the
          courier right now, whatever the last check said.
          {order.lastSyncedAt
            ? ` Last checked ${new Date(order.lastSyncedAt).toLocaleString("en-IN")}.`
            : ""}
        </InfoTip>

        {canSync && (
          <Btn
            tone="outline"
            onClick={sync}
            disabled={syncing}
            className="ml-auto"
            title="Ask NimbusPost where this parcel is now"
          >
            {syncing ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-3 w-3" aria-hidden />
            )}
            Sync
          </Btn>
        )}
      </div>

      {/* ---- Hand-editing, folded ----
          Kept, because a parcel booked outside NimbusPost is tracked entirely
          from here and a wrong link has to be fixable. Folded, because after a
          real booking these three fields are a *second writer* for columns the
          courier owns — the same shape of bug as the two editors CLAUDE.md
          records for `defaultReturnsInfo`. */}
      {editing ? (
        <ManualTracking order={order} onClose={() => setEditing(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg text-[11px] text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Correct the courier details by hand
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  3. Ready or staged — the manual dispatch path                      */
/* ------------------------------------------------------------------ */

/**
 * The manual dispatch path — the one that matters when
 * `dispatchOnConfirm: "off"`, because then it is the *only* path.
 *
 * The owner: *"curior chose karna ka option admin >> order me nahi show ho raha
 * hai. if setting is DO nothing at What happens on confirmation then admin yaha
 * se curior chose karke draft or book kar sakta hai"* — with nothing automatic,
 * choosing the courier has to be possible here, and choosing it must lead to
 * **either** verb.
 *
 * What was wrong was not that the rates were missing; it was that the only door
 * to them was a button called **Ship now**, and every row inside it said
 * **Book**. Choosing a courier and *drafting* with it could not be expressed,
 * so the courier choice looked like it did not exist for anyone who was not
 * ready to spend money. The free verb, "Send draft", stood outside the picker
 * and staged a carrier-less draft.
 *
 * Now: **Choose courier** opens the live rates, cheapest first, a row is
 * selected (the saved choice, else the cheapest), and the two verbs sit under
 * the table sharing that one choice —
 *
 *   - **Stage draft with X** — free, reversible, no AWB. Records the carrier.
 *   - **Book with X — ₹n** — confirmed first, names the wallet charge *and*
 *     what the courier collects at the door, then generates the AWB.
 *
 * **Send draft** survives beside it as the no-decision shortcut, for the
 * common case of staging now and choosing the carrier later.
 *
 * Draft-first is untouched: booking still goes through `shipOrderNow`, which
 * stages a draft before it books when none exists. `createShipment()` stays
 * unused.
 *
 * Which verbs exist comes from the gate, never from a local re-reading of
 * `nimbusShipmentId`.
 */
function ShipmentActions({
  order,
  gate,
}: {
  order: AdminOrder;
  gate: ReturnType<typeof shipmentGateFor>;
}) {
  const router = useRouter();
  const [drafting, startDraft] = useTransition();
  const [syncing, startSync] = useTransition();
  const [picking, setPicking] = useState(false);

  const staged = gate.stage === "draft";

  function draft() {
    startDraft(async () => {
      const res = await draftOrderInNimbusAction(order.id);
      if (!res.ok) {
        toast.error(res.error, { duration: 10000 });
        return;
      }
      toast.success(
        res.alreadyStaged
          ? "A draft was already waiting in NimbusPost."
          : "Draft staged in NimbusPost — no courier, no AWB, nothing charged.",
        {
          description:
            "Book it here, or in the NimbusPost dashboard and then press Sync.",
          duration: 9000,
        }
      );
      router.refresh();
    });
  }

  function sync() {
    startSync(async () => {
      const res = await syncOrderFromNimbusAction(order.id);
      if (!res.ok) {
        toast.error(res.error || "Could not sync", { duration: 8000 });
        return;
      }
      if (res.outcome === "not-booked") {
        toast.info(
          `Not booked in NimbusPost yet (status: ${res.orderStatus}). The draft is still waiting there.`,
          { duration: 7000 }
        );
      } else if (res.outcome === "tracked") {
        toast.success(res.deliveryStatus ?? "No new scan yet.");
      } else {
        toast.success(
          `Synced — AWB ${res.awb}${res.courier ? ` (${res.courier})` : ""}`
        );
      }
      router.refresh();
    });
  }

  const busy = drafting || syncing;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={staged ? "info" : "neutral"} title={gate.reason}>
          {staged ? (
            <FileText className="h-2.5 w-2.5" aria-hidden />
          ) : (
            <Truck className="h-2.5 w-2.5" aria-hidden />
          )}
          {staged ? "Draft staged" : "Not staged"}
        </Badge>
        {/* The carrier already attached to this order — pre-picked by the
            confirmation pipeline on `draft`/`book`, or chosen here. Shown
            outside the picker so "which courier is this going with?" is
            answerable without opening anything. */}
        {order.nimbusCourierName && (
          <Badge
            tone="accent"
            title={`This order is set to go with ${order.nimbusCourierName}. Open Choose courier to change it.`}
          >
            <Truck className="h-2.5 w-2.5" aria-hidden />
            {order.nimbusCourierName}
          </Badge>
        )}
        <InfoTip term="Draft vs booked">
          A <b>draft</b> is an unbooked order sitting in NimbusPost: no AWB, no
          charge, and you can withdraw it — it can carry the courier you intend
          to use, but nothing is allocated. <b>Booking</b> allocates that
          courier, generates the AWB and takes the money out of your NimbusPost
          wallet. They are separate buttons on purpose.
        </InfoTip>

        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          {(gate.can.shipNow || gate.can.book) && (
            <Btn
              tone="accent"
              onClick={() => setPicking((v) => !v)}
              disabled={busy}
              aria-expanded={picking}
              title="See the live rates for this parcel and pincode, then draft or book with the courier you pick"
            >
              {picking ? (
                <>
                  <X className="h-3.5 w-3.5" aria-hidden /> Close rates
                </>
              ) : (
                <>
                  <Truck className="h-3.5 w-3.5" aria-hidden />
                  Choose courier
                </>
              )}
            </Btn>
          )}

          {gate.can.draft && (
            <Btn
              tone="outline"
              onClick={draft}
              disabled={busy || picking}
              title="Stage the unbooked draft without choosing a courier. Free, and you can withdraw it."
            >
              {drafting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <FileText className="h-3.5 w-3.5" aria-hidden />
              )}
              Send draft
            </Btn>
          )}

          {gate.can.sync && (
            <Btn
              onClick={sync}
              disabled={busy || picking}
              title="Booked it in the NimbusPost dashboard? Pull the AWB in."
            >
              {syncing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              )}
              Sync
            </Btn>
          )}

          {gate.can.cancelDraft && !picking && <CancelDraftButton order={order} />}
        </span>
      </div>

      {/* Conditionally rendered, never parked offscreen with a transform —
          see the modal note in CLAUDE.md. */}
      {picking && (
        <CourierPicker
          order={order}
          canDraft={gate.can.draft}
          onDone={() => setPicking(false)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Choose courier: live rates → pick one → draft OR book              */
/* ------------------------------------------------------------------ */

/**
 * The courier choice, and both things you can do with it.
 *
 * Fetch the live rates for this parcel and pincode (cheapest first), select
 * one, and then take **either** verb with that selection: stage a free draft
 * for it, or book it and generate the AWB.
 *
 * ## Why the verbs are under the table, not in the rows
 *
 * A Book button on every row was the whole picker: the only thing choosing a
 * courier could lead to was spending money, which is why an owner running
 * `dispatchOnConfirm: "off"` could not find a way to choose a courier *and
 * draft*. Selecting a row and acting on the selection separates the choice
 * from the consequence — the same reason `dispatchOrder` cannot create-and-book
 * in one call.
 *
 * It also removes a real hazard: six numeric columns with a violet **Book** at
 * the end of each row means the button that charges the wallet is the widest
 * target on the panel, repeated once per courier.
 *
 * The **collection line** is read straight off `resolveCollection()` via the
 * server — never recomputed here. That rule is what stops a prepaid customer
 * being charged a second time at their door, and it is printed above the verbs
 * so it is checkable *before* the money moves rather than after.
 */
function CourierPicker({
  order,
  canDraft,
  onDone,
}: {
  order: AdminOrder;
  /** From the gate: is staging a draft still one of the things to do here? */
  canDraft: boolean;
  onDone: () => void;
}) {
  const router = useRouter();
  const [booking, startBook] = useTransition();
  const [drafting, startDraft] = useTransition();
  const [loading, setLoading] = useState(true);
  const [options, setOptions] = useState<CourierOption[] | null>(null);
  const [collection, setCollection] = useState<Collection | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  /**
   * The selected courier's id. `undefined` means "nothing chosen by hand yet",
   * which resolves to the saved choice and then to the cheapest — never to
   * nothing, so the two verbs below always have a subject.
   */
  const [chosenId, setChosenId] = useState<string | undefined>(undefined);

  // Quoted on mount rather than behind another press: opening the panel *is*
  // the request for rates, and making the admin ask twice is the two-step flow
  // this panel replaced.
  //
  // `loading` starts true from `useState` rather than being set here: the panel
  // is conditionally rendered, so it mounts fresh for exactly one order and an
  // effect that opens by calling setState is a cascading render for nothing.
  // `cancelled` guards the unmount — closing the panel mid-request is normal.
  const orderId = order.id;
  useEffect(() => {
    let cancelled = false;
    getCourierOptionsAction(orderId)
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) setQuoteError(res.error);
        else {
          setOptions(res.options);
          setCollection(res.collection);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setQuoteError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  // Derived during render, not stored in an effect: the saved choice if it is
  // still quoting for this parcel, else the cheapest — which is `options[0]`,
  // because `listCourierOptions` sorts by total.
  const saved = order.nimbusCourierId;
  const selected =
    options?.find((o) => o.courierId === chosenId) ??
    options?.find((o) => o.courierId === saved) ??
    options?.[0] ??
    null;

  function collectsLine(): string {
    if (!collection) return "";
    return collection.paymentType === "cod"
      ? `The courier will collect ${formatINR(collection.collectAmount)} at the door.`
      : "The courier will collect nothing at the door.";
  }

  /**
   * Stage the draft **for the selected courier**. Free, reversible, no AWB —
   * so no confirmation, exactly like the bare "Send draft" button.
   *
   * The carrier travels with the draft rather than being saved in a second
   * press: a draft staged with no carrier and a carrier saved against no draft
   * are both half-states someone then has to notice.
   */
  function draftWith(option: CourierOption) {
    startDraft(async () => {
      const res = await draftOrderInNimbusAction(
        order.id,
        option.courierId,
        option.name
      );
      if (!res.ok) {
        toast.error(res.error, { duration: 10000 });
        return;
      }
      toast.success(
        res.alreadyStaged
          ? `A draft was already waiting in NimbusPost — ${option.name} is saved for it.`
          : `Draft staged for ${option.name} — no AWB, nothing charged.`,
        {
          description: `Booking it will charge ${formatINR(option.total)}. ${collectsLine()}`,
          duration: 9000,
        }
      );
      onDone();
      router.refresh();
    });
  }

  function book(option: CourierOption | null) {
    const who = option ? option.name : "whichever courier NimbusPost allocates";
    const charge = option
      ? `Your NimbusPost wallet will be charged ${formatINR(option.total)}.`
      : "Your NimbusPost wallet will be charged at NimbusPost's rate.";
    const collects = collectsLine();

    if (
      !confirm(
        `Book order ${order.orderNumber} with ${who}?\n\n${charge}\n${collects}\n\nThis generates a real AWB and cannot be undone from this screen.`
      )
    ) {
      return;
    }

    startBook(async () => {
      const res = await shipOrderNowAction(
        order.id,
        option?.courierId ?? null,
        option?.name ?? null
      );
      if (!res.ok) {
        // The draft survives a failed booking, so say so — otherwise the
        // operator re-drafts and ends up with two orders in NimbusPost.
        toast.error(res.error, {
          description:
            "Nothing was booked and nothing was charged. Any draft in NimbusPost is still there.",
          duration: 14000,
        });
        router.refresh();
        return;
      }
      toast.success(
        `Booked — AWB ${res.awb}${res.courier ? ` (${res.courier})` : ""}`,
        { duration: 8000 }
      );
      if (res.courierMismatch) {
        toast.warning(res.courierMismatch, { duration: 12000 });
      }
      onDone();
      router.refresh();
    });
  }

  function clearChoice() {
    startBook(async () => {
      await chooseCourierAction(order.id, null, null);
      toast.success("Courier choice cleared");
      router.refresh();
    });
  }

  // One busy flag for the whole panel: drafting and booking both write to the
  // same order, so allowing the second while the first is in flight is how an
  // order ends up with two NimbusPost records.
  const busyPicker = booking || drafting;

  return (
    <div className="overflow-hidden rounded-lg border border-accent/40">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-accent/5 px-2.5 py-1.5">
        <p className="text-[11px] font-medium uppercase tracking-wider">
          Pick a courier
        </p>
        <InfoTip term="Courier rates">
          What your NimbusPost wallet is charged if you book with that courier —
          forward leg, return-to-origin and the COD collection fee. Cheapest
          first, and the cheapest is selected for you. Choosing a row changes
          nothing on its own: the two buttons underneath are what stage a free
          draft or book the AWB with it.
        </InfoTip>
      </div>

      {/* What the courier collects. Stated before any Book button, because it
          is the one number that costs a customer real money if it is wrong. */}
      {collection && (
        <p
          className={cn(
            "flex flex-wrap items-center gap-1.5 border-b border-border px-2.5 py-1.5 text-xs",
            collection.paymentType === "cod"
              ? "bg-orange-500/10 text-orange-700 dark:text-orange-400"
              : "bg-muted/40 text-muted-foreground"
          )}
        >
          {collection.paymentType === "cod" ? (
            <>
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="font-medium">
                The courier collects {formatINR(collection.collectAmount)} at the
                door.
              </span>
            </>
          ) : (
            <>
              <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>Prepaid — the courier collects nothing.</span>
            </>
          )}
          <InfoTip term="What the courier collects">
            {collection.reason}
          </InfoTip>
        </p>
      )}

      {loading && (
        <p className="flex items-center gap-2 px-2.5 py-3 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Checking live rates for {order.pincode}…
        </p>
      )}

      {quoteError && (
        <div className="space-y-1.5 p-2.5">
          <p className="flex items-start gap-1.5 text-xs text-danger">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{quoteError}</span>
          </p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Rates and booking are different endpoints, so a quote that fails does
            not mean the booking will. You can let NimbusPost allocate a courier
            instead — you will still see which one it picked.
          </p>
          <Btn tone="accent" onClick={() => book(null)} disabled={busyPicker}>
            {booking && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            Book without choosing
          </Btn>
        </div>
      )}

      {options && options.length > 0 && (
        // The one place a horizontal scroller is acceptable: six numeric
        // columns that mean nothing stacked. It scrolls inside its own card,
        // so the page itself never overflows at 320px.
        <div className="max-h-64 overflow-auto overscroll-contain">
          <table className="w-full min-w-[540px] text-xs">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-2.5 py-1">
                  <span className="sr-only">Choose</span>
                </th>
                <th className="px-2.5 py-1 font-medium">Courier</th>
                <th className="px-2.5 py-1 font-medium">ETA</th>
                <th className="px-2.5 py-1 font-medium">Forward</th>
                <th className="px-2.5 py-1 font-medium">RTO</th>
                <th className="px-2.5 py-1 font-medium">COD</th>
                <th className="px-2.5 py-1 font-medium">Charge</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {options.map((c, i) => {
                const saved = order.nimbusCourierId === c.courierId;
                const on = selected?.courierId === c.courierId;
                const rowId = `courier-${order.id}-${c.courierId}`;
                return (
                  // The whole row is the radio's label, so the 10px target in
                  // the first cell is not the only way to change the choice.
                  <tr
                    key={c.courierId}
                    className={cn(
                      "cursor-pointer transition-colors",
                      on ? "bg-accent/10" : "hover:bg-muted/50"
                    )}
                    onClick={() => setChosenId(c.courierId)}
                  >
                    <td className="px-2.5 py-1">
                      <input
                        type="radio"
                        id={rowId}
                        name={`courier-${order.id}`}
                        checked={on}
                        onChange={() => setChosenId(c.courierId)}
                        className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent)]"
                        aria-label={`Choose ${c.name} at ${formatINR(c.total)}`}
                      />
                    </td>
                    <td className="px-2.5 py-1">
                      <label htmlFor={rowId} className="cursor-pointer font-medium">
                        {c.name}
                      </label>
                      {i === 0 && (
                        <Badge tone="success" className="ml-1.5">
                          cheapest
                        </Badge>
                      )}
                      {saved && (
                        <Badge tone="accent" className="ml-1.5">
                          saved
                        </Badge>
                      )}
                      {c.type && (
                        <span className="block text-[10px] text-muted-foreground">
                          {c.type}
                          {c.chargeableGrams
                            ? ` · charged for ${c.chargeableGrams} g`
                            : ""}
                        </span>
                      )}
                    </td>
                    <td className="px-2.5 py-1 text-muted-foreground">
                      {c.tatDays ? `${c.tatDays} d` : "—"}
                    </td>
                    <td className="px-2.5 py-1 tabular-nums">
                      {formatINR(c.forward)}
                    </td>
                    <td className="px-2.5 py-1 tabular-nums text-muted-foreground">
                      {c.rto ? formatINR(c.rto) : "—"}
                    </td>
                    <td className="px-2.5 py-1 tabular-nums text-muted-foreground">
                      {c.cod ? formatINR(c.cod) : "—"}
                    </td>
                    <td className="px-2.5 py-1 font-medium tabular-nums">
                      {formatINR(c.total)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- The two verbs, sharing one choice ----
          Free on the left, money on the right, and the money one names both
          the wallet charge and what the courier collects before it is pressed
          (again, in the confirm). */}
      {selected && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border bg-muted/30 px-2.5 py-2">
          <p className="min-w-0 flex-1 text-[11px] leading-snug">
            <span className="text-muted-foreground">Chosen: </span>
            <b>{selected.name}</b>
            <span className="text-muted-foreground">
              {" · "}
              {formatINR(selected.total)} to your wallet
              {selected.tatDays ? ` · about ${selected.tatDays} d` : ""}
            </span>
          </p>

          {canDraft && (
            <Btn
              tone="outline"
              onClick={() => draftWith(selected)}
              disabled={busyPicker}
              title={`Stage an unbooked draft for ${selected.name}. Free, and you can withdraw it.`}
            >
              {drafting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <FileText className="h-3.5 w-3.5" aria-hidden />
              )}
              Draft with {selected.name}
            </Btn>
          )}

          <Btn
            tone="accent"
            onClick={() => book(selected)}
            disabled={busyPicker}
            title={`Book with ${selected.name}, generate the AWB and charge your wallet ${formatINR(selected.total)}`}
          >
            {booking ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Truck className="h-3.5 w-3.5" aria-hidden />
            )}
            Book — {formatINR(selected.total)}
          </Btn>
        </div>
      )}

      {options && options.length === 0 && (
        <p className="p-2.5 text-xs text-muted-foreground">
          No courier quoted a rate for this parcel and pincode.
        </p>
      )}

      {order.nimbusCourierName && (
        <p className="flex flex-wrap items-center gap-2 border-t border-border px-2.5 py-1.5 text-[11px] text-muted-foreground">
          Saved choice: <b className="text-foreground">{order.nimbusCourierName}</b>
          <button
            type="button"
            onClick={clearChoice}
            disabled={busyPicker}
            className="inline-flex min-h-9 cursor-pointer items-center underline underline-offset-2 hover:text-foreground disabled:opacity-50"
          >
            clear
          </button>
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Manual courier fields                                              */
/* ------------------------------------------------------------------ */

/**
 * The by-hand courier/AWB/link editor, for a parcel shipped outside
 * NimbusPost — or to correct a link. Only ever reached deliberately, from the
 * fold on a booked shipment, so it can never be mistaken for the way to ship
 * an order.
 */
function ManualTracking({
  order,
  onClose,
}: {
  order: AdminOrder;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [courier, setCourier] = useState(order.courier ?? "");
  const [trackingNumber, setTrackingNumber] = useState(order.trackingNumber ?? "");
  const [trackingUrl, setTrackingUrl] = useState(order.trackingUrl ?? "");

  function save() {
    start(async () => {
      const res = await updateOrderTracking(order.id, {
        courier,
        trackingNumber,
        trackingUrl,
      });
      if (res.ok) {
        toast.success("Tracking saved");
        onClose();
        router.refresh();
      } else toast.error(res.error || "Failed to save");
    });
  }

  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-muted/20 p-2.5">
      <p className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
        Editing the courier details by hand
        <InfoTip term="Editing by hand">
          These three fields are what the customer sees on their order and in
          their account. For a parcel booked through NimbusPost they are written
          by the courier sync, so anything you type here will be overwritten the
          next time a scan arrives. Use it for a parcel booked outside
          NimbusPost, or to fix a broken tracking link.
        </InfoTip>
      </p>

      <div className="grid gap-1.5 sm:grid-cols-3">
        <LabelledField label="Courier">
          <input
            value={courier}
            onChange={(e) => setCourier(e.target.value)}
            className="input h-9 text-xs"
            placeholder="e.g. Delhivery"
          />
        </LabelledField>
        <LabelledField label="Tracking number">
          <input
            value={trackingNumber}
            onChange={(e) => setTrackingNumber(e.target.value)}
            className="input h-9 text-xs"
            placeholder="e.g. 1234567890"
          />
        </LabelledField>
        <LabelledField label="Tracking URL">
          <input
            value={trackingUrl}
            onChange={(e) => setTrackingUrl(e.target.value)}
            className="input h-9 text-xs"
            placeholder="https://…"
          />
        </LabelledField>
      </div>

      <div className="flex flex-wrap justify-end gap-1.5">
        <Btn tone="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Btn>
        <Btn tone="solid" onClick={save} disabled={pending}>
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          Save tracking
        </Btn>
      </div>
    </div>
  );
}
