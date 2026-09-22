/**
 * NimbusPost delivery-status webhook
 * POST /api/webhooks/nimbuspost
 *
 * NimbusPost calls this URL every time a shipment status changes (e.g.
 * "picked up", "in transit", "out for delivery", "delivered").
 *
 * Setup (one-time in NimbusPost dashboard):
 *   ship.nimbuspost.com → Settings → Webhook → enter this URL + your secret
 *
 * Security: NimbusPost sends the secret you configure in the
 *   x-nimbuspost-webhook-secret  (or X-NimbusPost-Token) header.
 *   Set NIMBUSPOST_WEBHOOK_SECRET in your .env to enable verification.
 *   Without the env var the route is disabled (returns 403) so you never
 *   accidentally expose it.
 *
 * Payload shape (NimbusPost may vary by version — we read defensively):
 * {
 *   "awb": "12345678",
 *   "status": "DELIVERED",
 *   "courier": "Delhivery",
 *   "location": "Mumbai",
 *   "timestamp": "2024-07-01T14:30:00Z",
 *   "remark": "Delivered to customer"
 * }
 *
 * ## An AWB can belong to two different things
 *
 * NimbusPost sends the same payload shape for a forward shipment (order → the
 * customer) and a reverse pickup (customer → us, for a return). Nothing in the
 * body distinguishes them, so this route resolves the AWB against **both**
 * `Order.trackingNumber` and `ReturnRequest.nimbusAwb`.
 *
 * This used to look only at orders, which meant every reverse scan was logged
 * as "No order found — ignoring" and dropped: a return could never hear from
 * the courier, and a pickup booked in the NimbusPost dashboard was invisible
 * forever.
 *
 * The two must never be conflated. A reverse AWB written onto
 * `Order.trackingNumber` would overwrite the forward AWB and feed reverse scans
 * to the order's status machine — "collected from the customer" would read as
 * "your order shipped", and a failed pickup would cancel a delivered order. If
 * one AWB somehow matches both records this route **refuses to guess**: see the
 * collision branch below.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { sendOrderStatusEmail } from "@/lib/email";
import { revalidatePath } from "next/cache";
import { mapNimbusStatus, NOTIFY_STATUSES } from "@/lib/nimbus-status";
import { applyReverseScan } from "@/lib/nimbus-returns";
import { isRtoStatus } from "@/lib/returns";

// ---------------------------------------------------------------------------
// The status table and the "worth emailing about" set both live in
// lib/nimbus-status.ts. They used to be declared here AND in fulfilment.ts,
// and had drifted — see that file for what that cost.
// ---------------------------------------------------------------------------
const EMAIL_STATUSES = NOTIFY_STATUSES;

type StatusEntry = { status: string; note?: string; at: string };

export async function POST(req: NextRequest) {
  // ---- 1. Verify the shared secret ----------------------------------------
  const secret = process.env.NIMBUSPOST_WEBHOOK_SECRET;
  if (!secret) {
    // If no secret is configured we refuse all calls — prevents accidental exposure.
    console.warn("[nimbus-webhook] NIMBUSPOST_WEBHOOK_SECRET not set — refusing.");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 403 });
  }

  // The secret can arrive as a ?secret= query param (easiest — you register the
  // full URL incl. the query in NimbusPost) or in a header.
  const receivedSecret =
    req.nextUrl.searchParams.get("secret") ??
    req.headers.get("x-nimbuspost-webhook-secret") ??
    req.headers.get("x-webhook-secret") ??
    req.headers.get("x-nimbuspost-token") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (receivedSecret !== secret) {
    console.warn("[nimbus-webhook] Secret mismatch — ignoring call.");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ---- 2. Parse the payload ------------------------------------------------
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Read the AWB — NimbusPost may use "awb", "awb_number", or "tracking_id".
  const awb =
    String(body.awb ?? body.awb_number ?? body.tracking_id ?? "").trim();
  if (!awb) {
    console.warn("[nimbus-webhook] No AWB in payload:", body);
    return NextResponse.json({ received: true }); // acknowledge but skip
  }

  const nimbusStatusRaw = String(
    body.status ?? body.tracking_status ?? ""
  ).trim();
  const nimbusStatus = nimbusStatusRaw.toLowerCase();
  const location = String(body.location ?? body.city ?? "").trim();
  const remark = String(body.remark ?? body.message ?? "").trim();
  const nimbusAt =
    body.timestamp || body.updated_at
      ? new Date(String(body.timestamp ?? body.updated_at)).toISOString()
      : new Date().toISOString();

  // ---- 3. Resolve the AWB — forward shipment OR reverse pickup -------------
  //
  // Both are queried, always, rather than falling through from one to the
  // other. Checking orders first and returning early is what made every reverse
  // scan vanish; checking returns first would hide a collision just as well.
  const [order, returnRequest] = await Promise.all([
    prisma.order.findFirst({ where: { trackingNumber: awb } }).catch(() => null),
    prisma.returnRequest
      .findFirst({
        where: { nimbusAwb: awb },
        select: { id: true, requestNumber: true },
      })
      .catch(() => null),
  ]);

  // ---- 3a. Collision — refuse to guess ------------------------------------
  //
  // One AWB matching a forward shipment AND a reverse pickup cannot be resolved
  // from this payload, and acting on either would be a coin flip that moves the
  // wrong record: mark a live order cancelled, or mark a return received.
  // Nothing is changed and the pairing is named loudly, because this is a data
  // fault a human has to unpick, not an event to be absorbed.
  if (order && returnRequest) {
    console.error(
      `[nimbus-webhook] AWB COLLISION ${awb} — matches order ${order.orderNumber} AND return ${returnRequest.requestNumber}. ` +
        `Status "${nimbusStatusRaw}" NOT applied to either; one of the two records has the wrong AWB.`
    );
    return NextResponse.json(
      {
        received: true,
        skipped: "awb-collision",
        order: order.orderNumber,
        return: returnRequest.requestNumber,
      },
      { status: 409 }
    );
  }

  // ---- 3b. Reverse pickup — the goods are coming back ----------------------
  if (returnRequest) {
    // One shared write path with the poller (`syncReturnFromNimbus`), so push
    // and poll can never disagree about what a scan meant — the exact drift
    // lib/nimbus-status.ts was created to end.
    const moved = await applyReverseScan(returnRequest.id, {
      raw: nimbusStatusRaw || "Status update",
      location: location || null,
      courier: String(body.courier ?? body.courier_name ?? "").trim() || null,
      by: "nimbus-webhook",
    }).catch((err) => {
      console.error("[nimbus-webhook] reverse scan failed:", err);
      return null;
    });

    try {
      revalidatePath("/admin/returns");
      revalidatePath("/admin");
    } catch {
      // revalidatePath can throw outside a request context in some edge configs.
    }

    console.log(
      `[nimbus-webhook] AWB ${awb} → "${nimbusStatusRaw}" on return ${returnRequest.requestNumber}${moved ? ` (now ${moved})` : " (recorded, status unchanged)"}`
    );

    // No customer email on the reverse leg: `sendOrderStatusEmail` speaks about
    // an order's progress ("your order has shipped"), which is actively wrong
    // for a parcel travelling the other way. A return-specific template is the
    // right fix and belongs with the other mail in lib/email.ts.
    return NextResponse.json({
      received: true,
      leg: "reverse",
      status: moved ?? "recorded",
    });
  }

  if (!order) {
    // Could be from a test ping or a shipment not in our DB — not an error.
    console.log(`[nimbus-webhook] No order or return found for AWB ${awb} — ignoring.`);
    return NextResponse.json({ received: true });
  }

  // ---- 4. Map to internal status ------------------------------------------
  const newStatus = mapNimbusStatus(nimbusStatus);

  // Don't downgrade a delivered order.
  if (order.status === "delivered" && newStatus !== "delivered") {
    return NextResponse.json({ received: true, skipped: "already delivered" });
  }

  // Build the history note.
  const noteParts = [nimbusStatusRaw || "Status update"];
  if (location) noteParts.push(`at ${location}`);
  if (remark && remark !== nimbusStatusRaw) noteParts.push(remark);
  // RTO is spelled out rather than left as courier jargon. `mapNimbusStatus`
  // turns "rto delivered" into the order status `cancelled`, which is correct
  // for the order but says nothing about the parcel physically arriving back on
  // our shelf — or about a prepaid customer who is now owed their money. The
  // status can't carry that (there is no RTO order status), so the timeline
  // does. Admin → Returns lists these under "Coming back to you".
  if (isRtoStatus(nimbusStatusRaw)) {
    noteParts.push(
      "RTO — delivery failed, the parcel is being returned to you. Check whether a refund is owed."
    );
  }
  const note = noteParts.join(" — ");

  const history = Array.isArray(order.statusHistory)
    ? (order.statusHistory as unknown as StatusEntry[])
    : [];

  history.push({
    status: newStatus ?? order.status,
    note: `NimbusPost: ${note}`,
    at: nimbusAt,
  });

  // ---- 5. Persist to DB ---------------------------------------------------
  await prisma.order
    .update({
      where: { id: order.id },
      data: {
        // Only change status if we have a recognised mapping.
        ...(newStatus ? { status: newStatus } : {}),
        // Always record the raw courier status for live display. These are the
        // same columns the polling sync writes, so push and poll cannot show
        // two different "latest" states.
        deliveryStatus: nimbusStatusRaw || order.deliveryStatus,
        deliveryLocation: location || order.deliveryLocation,
        deliveryStatusAt: new Date(nimbusAt),
        lastSyncedAt: new Date(),
        statusHistory: history as unknown as object[],
      },
    })
    .catch((err) => console.error("[nimbus-webhook] DB update failed:", err));

  // ---- 6. Email the customer for key milestones ---------------------------
  if (newStatus && EMAIL_STATUSES.has(newStatus) && newStatus !== order.status) {
    try {
      const settings = await getSettings();
      await sendOrderStatusEmail(settings, {
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        email: order.email,
        status: newStatus,
        courier: order.courier,
        trackingNumber: order.trackingNumber,
        trackingUrl: order.trackingUrl,
      });
    } catch (err) {
      console.error("[nimbus-webhook] Email failed:", err);
    }
  }

  // Revalidate the admin orders page so the new status shows immediately.
  try {
    revalidatePath("/admin/orders");
    revalidatePath("/admin");
  } catch {
    // revalidatePath can throw outside a request context in some edge configs.
  }

  console.log(
    `[nimbus-webhook] AWB ${awb} → "${nimbusStatusRaw}" (${newStatus ?? "unmapped"}) for order ${order.orderNumber}`
  );

  return NextResponse.json({ received: true, status: newStatus ?? "recorded" });
}

// Open this URL in a browser to confirm the endpoint is live (no secret needed).
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "nimbuspost-webhook",
    configured: Boolean(process.env.NIMBUSPOST_WEBHOOK_SECRET),
  });
}
