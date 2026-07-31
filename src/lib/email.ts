import "server-only";
import { Resend } from "resend";
import type { SettingsDTO } from "./types";
import { formatINR } from "./utils";

const apiKey = process.env.RESEND_API_KEY;
const FROM = process.env.EMAIL_FROM || "Level7 Clothing <onboarding@resend.dev>";

const resend = apiKey ? new Resend(apiKey) : null;

async function send(opts: {
  to: string | string[];
  subject: string;
  html: string;
}) {
  if (!resend) {
    console.warn(
      `[email] RESEND_API_KEY not set — skipping email "${opts.subject}" to ${opts.to}`
    );
    return { skipped: true };
  }
  try {
    const res = await resend.emails.send({ from: FROM, ...opts });
    if (res.error) console.error("[email] send error:", res.error);
    return res;
  } catch (err) {
    console.error("[email] send threw:", err);
    return { error: err };
  }
}

function shell(brand: string, title: string, body: string) {
  return `<!doctype html><html><body style="margin:0;background:#f5f3ef;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1a1a1a">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px">
    <div style="background:#fff;border-radius:16px;overflow:hidden;border:1px solid #eee">
      <div style="background:#141210;color:#fff;padding:22px 28px">
        <div style="font-size:20px;font-weight:700;letter-spacing:.5px">${brand}</div>
        <div style="font-size:13px;opacity:.7;margin-top:2px">${title}</div>
      </div>
      <div style="padding:28px">${body}</div>
    </div>
    <div style="text-align:center;color:#999;font-size:12px;margin-top:16px">Sent automatically by your ${brand} website.</div>
  </div></body></html>`;
}

/** Fired when someone adds a product to their cart (a warm lead). */
export async function sendLeadEmail(
  settings: SettingsDTO,
  lead: {
    productName: string;
    quantity: number;
    price?: number | null;
    name?: string | null;
    phone?: string | null;
  }
) {
  const body = `
    <p style="font-size:15px;margin:0 0 12px">${lead.name ? `<b>${lead.name}</b> just added a product to their cart — a warm lead 👀` : "A visitor just added a product to their cart — a potential lead 👀"}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      ${lead.name ? `<tr><td style="padding:8px 0;color:#777">Name</td><td style="padding:8px 0;text-align:right;font-weight:600">${lead.name}</td></tr>` : ""}
      ${lead.phone ? `<tr><td style="padding:8px 0;color:#777">Mobile</td><td style="padding:8px 0;text-align:right;font-weight:600">${lead.phone}</td></tr>` : ""}
      <tr><td style="padding:8px 0;color:#777">Product</td><td style="padding:8px 0;text-align:right;font-weight:600">${lead.productName}</td></tr>
      <tr><td style="padding:8px 0;color:#777">Quantity</td><td style="padding:8px 0;text-align:right">${lead.quantity}</td></tr>
      ${lead.price != null ? `<tr><td style="padding:8px 0;color:#777">Price</td><td style="padding:8px 0;text-align:right">${formatINR(lead.price)}</td></tr>` : ""}
    </table>
    <p style="font-size:13px;color:#999;margin-top:16px">See all interested customers in your admin panel → Interested customers.</p>`;
  return send({
    to: settings.adminNotifyEmail,
    subject: `🛒 New lead${lead.name ? ` from ${lead.name}` : ""}: ${lead.productName} added to cart`,
    html: shell(settings.brandName, "New cart lead", body),
  });
}

type OrderLike = {
  orderNumber: string;
  customerName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  items: {
    name: string;
    quantity: number;
    price: number;
    options?: { name: string; value: string }[];
  }[];
  subtotal: number;
  shipping: number;
  total: number;
  paymentMethod: string;
  note?: string | null;
};

function itemsTable(items: OrderLike["items"]) {
  const rows = items
    .map((i) => {
      const opts =
        i.options && i.options.length > 0
          ? `<br><span style="color:#999;font-size:12px">${i.options.map((o) => `${o.name}: ${o.value}`).join(" · ")}</span>`
          : "";
      return `<tr><td style="padding:8px 0;border-bottom:1px solid #f0f0f0">${i.name} × ${i.quantity}${opts}</td><td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:right;vertical-align:top">${formatINR(i.price * i.quantity)}</td></tr>`;
    })
    .join("");
  return `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0">${rows}</table>`;
}

function totals(o: OrderLike) {
  return `<table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:4px 0;color:#777">Subtotal</td><td style="padding:4px 0;text-align:right">${formatINR(o.subtotal)}</td></tr>
    <tr><td style="padding:4px 0;color:#777">Shipping</td><td style="padding:4px 0;text-align:right">${o.shipping ? formatINR(o.shipping) : "Free"}</td></tr>
    <tr><td style="padding:8px 0;font-weight:700;font-size:16px">Total</td><td style="padding:8px 0;text-align:right;font-weight:700;font-size:16px">${formatINR(o.total)}</td></tr>
  </table>`;
}

/** Fired on a successful order — notifies admin and the customer. */
export async function sendOrderEmails(settings: SettingsDTO, order: OrderLike) {
  const address = `${order.address}, ${order.city}, ${order.state} - ${order.pincode}`;

  const adminBody = `
    <p style="font-size:15px;margin:0 0 4px">🎉 New order <b>${order.orderNumber}</b></p>
    ${itemsTable(order.items)}
    ${totals(order)}
    <div style="margin-top:16px;padding-top:16px;border-top:1px solid #eee;font-size:14px">
      <p style="margin:2px 0"><b>${order.customerName}</b></p>
      <p style="margin:2px 0;color:#555">${order.email} · ${order.phone}</p>
      <p style="margin:2px 0;color:#555">${address}</p>
      <p style="margin:8px 0 0;color:#555">Payment: <b>${order.paymentMethod}</b></p>
      ${order.note ? `<p style="margin:6px 0 0;color:#555">Note: ${order.note}</p>` : ""}
    </div>`;

  const customerBody = `
    <p style="font-size:15px;margin:0 0 4px">Hi ${order.customerName.split(" ")[0]}, thank you for your order! 🧡</p>
    <p style="font-size:14px;color:#555;margin:0 0 12px">Your order <b>${order.orderNumber}</b> is confirmed. We'll be in touch about dispatch.</p>
    ${itemsTable(order.items)}
    ${totals(order)}
    <div style="margin-top:16px;padding-top:16px;border-top:1px solid #eee;font-size:14px;color:#555">
      <p style="margin:2px 0">Delivering to: ${address}</p>
      <p style="margin:2px 0">Payment method: ${order.paymentMethod}</p>
    </div>
    <p style="font-size:13px;color:#999;margin-top:16px">Questions? Reply to this email or contact us at ${settings.contactEmail}.</p>`;

  await Promise.all([
    send({
      to: settings.adminNotifyEmail,
      subject: `✅ New order ${order.orderNumber} — ${formatINR(order.total)}`,
      html: shell(settings.brandName, "New order received", adminBody),
    }),
    send({
      to: order.email,
      subject: `Your ${settings.brandName} order ${order.orderNumber} is confirmed`,
      html: shell(settings.brandName, "Order confirmation", customerBody),
    }),
  ]);
}

/** Fired when a customer requests a password reset. */
export async function sendPasswordResetEmail(
  settings: SettingsDTO,
  to: string,
  resetUrl: string
) {
  const body = `
    <p style="font-size:15px;margin:0 0 12px">We received a request to reset your ${settings.brandName} account password.</p>
    <p style="font-size:14px;color:#555;margin:0 0 20px">Click the button below to choose a new password. This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
    <p style="margin:0 0 20px"><a href="${resetUrl}" style="display:inline-block;background:#141210;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-size:14px;font-weight:600">Reset my password</a></p>
    <p style="font-size:12px;color:#999;margin:0">Or paste this link into your browser:<br>${resetUrl}</p>`;
  return send({
    to,
    subject: `Reset your ${settings.brandName} password`,
    html: shell(settings.brandName, "Password reset", body),
  });
}

const STATUS_COPY: Record<string, string> = {
  pending: "We've received your order and it's being prepared.",
  confirmed: "Your order is confirmed and being packed with care.",
  shipped: "Good news — your order is on its way!",
  delivered: "Your order has been delivered. We hope you love it! 🧡",
  cancelled: "Your order has been cancelled. Contact us if this is unexpected.",
};

/** Fired when the admin updates an order's status. Keeps the customer in the loop. */
export async function sendOrderStatusEmail(
  settings: SettingsDTO,
  order: {
    orderNumber: string;
    customerName: string;
    email: string;
    status: string;
    courier?: string | null;
    trackingNumber?: string | null;
    trackingUrl?: string | null;
  }
) {
  const copy = STATUS_COPY[order.status] ?? "Your order status has been updated.";
  const tracking =
    order.status === "shipped" && (order.trackingNumber || order.courier)
      ? `<div style="margin-top:16px;padding:14px;background:#f7f5f1;border-radius:10px;font-size:14px">
           ${order.courier ? `<p style="margin:2px 0"><b>Courier:</b> ${order.courier}</p>` : ""}
           ${order.trackingNumber ? `<p style="margin:2px 0"><b>Tracking no:</b> ${order.trackingNumber}</p>` : ""}
           ${order.trackingUrl ? `<p style="margin:8px 0 0"><a href="${order.trackingUrl}" style="color:#141210">Track your shipment →</a></p>` : ""}
         </div>`
      : "";
  const body = `
    <p style="font-size:15px;margin:0 0 4px">Hi ${order.customerName.split(" ")[0]},</p>
    <p style="font-size:14px;color:#555;margin:0 0 8px">${copy}</p>
    <p style="font-size:14px;margin:12px 0 0">Order <b>${order.orderNumber}</b> — status: <b style="text-transform:capitalize">${order.status}</b></p>
    ${tracking}
    <p style="font-size:13px;color:#999;margin-top:20px">Track your order any time from your account on our website.</p>`;
  return send({
    to: order.email,
    subject: `Update on your ${settings.brandName} order ${order.orderNumber}`,
    html: shell(settings.brandName, "Order update", body),
  });
}

/** Fired when the contact form is submitted. */
export async function sendContactEmail(
  settings: SettingsDTO,
  msg: { name: string; email: string; phone?: string | null; message: string }
) {
  const body = `
    <p style="font-size:15px;margin:0 0 12px">New enquiry from your contact form.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:6px 0;color:#777">Name</td><td style="padding:6px 0;text-align:right;font-weight:600">${msg.name}</td></tr>
      <tr><td style="padding:6px 0;color:#777">Email</td><td style="padding:6px 0;text-align:right">${msg.email}</td></tr>
      ${msg.phone ? `<tr><td style="padding:6px 0;color:#777">Phone</td><td style="padding:6px 0;text-align:right">${msg.phone}</td></tr>` : ""}
    </table>
    <div style="margin-top:12px;padding:14px;background:#f7f5f1;border-radius:10px;font-size:14px;white-space:pre-wrap">${msg.message}</div>`;
  return send({
    to: settings.adminNotifyEmail,
    subject: `✉️ New enquiry from ${msg.name}`,
    html: shell(settings.brandName, "Contact form enquiry", body),
  });
}
