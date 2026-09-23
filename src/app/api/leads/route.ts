import { NextResponse } from "next/server";
import { z } from "zod";
import { runAutomationTrigger } from "@/lib/automation";
import { prisma } from "@/lib/prisma";

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

    // Automation rules bound to `cart.abandoned` — the only thing that emails
    // this event now.
    //
    // `sendLeadEmail` used to run just above, telling the owner a cart had been
    // filled. That is now a seeded rule with a zero delay ("Tell me when
    // something goes in a cart"), which is the same mail with a switch on it,
    // and it rides the same trigger as the 24-hour nudge to the shopper.
    //
    // Fired when the lead is *created*, not when a cart is later judged
    // abandoned — there is no such event on a serverless host. The rule's
    // `delayMinutes` is what makes it a nudge: a 24h rule queues an
    // `AutomationJob` for tomorrow, and the engine re-checks before sending, so
    // somebody who orders in the meantime is not chased for a cart they
    // emptied. Enqueue is idempotent on (rule, subject), so a shopper adding
    // three items does not get three nudges — and the owner's copy and the
    // shopper's nudge are separate rules, so each dedupes on its own.
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
