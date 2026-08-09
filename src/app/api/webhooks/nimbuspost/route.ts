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
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { sendOrderStatusEmail } from "@/lib/email";
import { revalidatePath } from "next/cache";

// ---------------------------------------------------------------------------
// Map NimbusPost status strings → your internal order statuses.
// Normalise to lowercase before lookup.
// ---------------------------------------------------------------------------
const NIMBUS_TO_STATUS: Record<string, string> = {
  // Pickup
  "pickup scheduled": "confirmed",
  "pickup done": "confirmed",
  "pickup cancelled": "pending",
  "manifest created": "confirmed",
  // In transit
  "in transit": "shipped",
  "reached destination": "shipped",
  "out for delivery": "shipped",
  // Delivered
  delivered: "delivered",
  // Failed / return
  "delivery failed": "shipped", // still shipped, just attempted
  "rto initiated": "shipped",
  "rto in transit": "shipped",
  "rto delivered": "cancelled",
};

// Statuses where we email the customer (the interesting milestones).
const EMAIL_STATUSES = new Set(["shipped", "delivered", "cancelled"]);

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

  // ---- 3. Find the order by AWB -------------------------------------------
  const order = await prisma.order
    .findFirst({ where: { trackingNumber: awb } })
    .catch(() => null);

  if (!order) {
    // Could be from a test ping or a shipment not in our DB — not an error.
    console.log(`[nimbus-webhook] No order found for AWB ${awb} — ignoring.`);
    return NextResponse.json({ received: true });
  }

  // ---- 4. Map to internal status ------------------------------------------
  const newStatus = NIMBUS_TO_STATUS[nimbusStatus] ?? null;

  // Don't downgrade a delivered order.
  if (order.status === "delivered" && newStatus !== "delivered") {
    return NextResponse.json({ received: true, skipped: "already delivered" });
  }

  // Build the history note.
  const noteParts = [nimbusStatusRaw || "Status update"];
  if (location) noteParts.push(`at ${location}`);
  if (remark && remark !== nimbusStatusRaw) noteParts.push(remark);
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
