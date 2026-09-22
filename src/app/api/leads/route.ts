import { NextResponse } from "next/server";
import { z } from "zod";
import { runAutomationTrigger } from "@/lib/automation";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { sendLeadEmail } from "@/lib/email";

export const runtime = "nodejs";

const schema = z.object({
  productId: z.string().optional(),
  productName: z.string().min(1),
  productImage: z.string().optional(),
  quantity: z.number().int().positive().default(1),
  price: z.number().int().nonnegative().optional(),
  visitorId: z.string().optional(),
  email: z.string().email().optional(),
  name: z.string().optional(),
  phone: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const data = schema.parse(body);

    const lead = await prisma.lead.create({ data });

    // Notify admin (don't fail the request if email is down / unconfigured).
    try {
      const settings = await getSettings();
      await sendLeadEmail(settings, {
        productName: data.productName,
        quantity: data.quantity,
        price: data.price ?? null,
        name: data.name ?? null,
        phone: data.phone ?? null,
      });
    } catch (err) {
      console.error("[leads] email failed:", err);
    }

    // Automation rules bound to `cart.abandoned`.
    //
    // Fired when the lead is *created*, not when a cart is later judged
    // abandoned — there is no such event on a serverless host. The rule's
    // `delayMinutes` is what makes it a nudge: a 24h rule queues an
    // `AutomationJob` for tomorrow, and the engine re-checks before sending, so
    // somebody who orders in the meantime is not chased for a cart they
    // emptied. Enqueue is idempotent on (rule, subject), so a shopper adding
    // three items does not get three nudges.
    await runAutomationTrigger("cart.abandoned", { id: lead.id }).catch((err) =>
      console.error("[leads] automation trigger failed:", err)
    );

    return NextResponse.json({ ok: true, id: lead.id });
  } catch (err) {
    console.error("[leads] error:", err);
    return NextResponse.json(
      { ok: false, error: "Could not record lead" },
      { status: 400 }
    );
  }
}
