/**
 * Automatic NimbusPost sync.
 * GET /api/cron/nimbus-sync
 *
 * Runs on the Vercel cron defined in vercel.json. Two jobs in one pass:
 *
 *  1. A staged DRAFT that someone booked in the NimbusPost dashboard has an AWB
 *     there and none here. Until it is pulled across, the customer gets no
 *     tracking link and the status webhook — which matches on AWB — can never
 *     find the order. This is what used to require pressing "Sync" by hand.
 *  2. A booked shipment gets its latest courier scan pulled in, so the status
 *     shown in the admin and on the customer's timeline keeps up on its own.
 *
 * Auth: Vercel sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is
 * set on the project. Without the env var the route refuses everything rather
 * than sitting open — this endpoint spends money's worth of API quota.
 */

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { syncAllOpenOrders } from "@/lib/fulfilment";

export const dynamic = "force-dynamic";
// Polling several orders in sequence outruns the default budget.
export const maxDuration = 60;

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return (
    header === secret || req.nextUrl.searchParams.get("secret") === secret
  );
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) {
    const configured = Boolean(process.env.CRON_SECRET?.trim());
    return NextResponse.json(
      {
        error: configured
          ? "Unauthorized"
          : "Set CRON_SECRET to enable the automatic sync.",
      },
      { status: configured ? 401 : 403 }
    );
  }

  const result = await syncAllOpenOrders();
  if (!result.ok) {
    // A disabled or unconfigured integration is not a failure worth retrying.
    console.log("[nimbus-sync] skipped:", result.error);
    return NextResponse.json({ skipped: result.error });
  }

  console.log(
    `[nimbus-sync] checked ${result.checked} · ${result.booked} newly booked · ${result.tracked} tracked · ${result.waiting} awaiting booking · ${result.failed} failed`
  );

  if (result.booked || result.tracked) {
    try {
      revalidatePath("/admin/orders");
      revalidatePath("/admin");
    } catch {
      // revalidatePath can throw outside a request context on some runtimes.
    }
  }

  return NextResponse.json(result);
}
