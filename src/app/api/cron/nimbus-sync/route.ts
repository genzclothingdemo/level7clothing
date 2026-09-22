/**
 * Automatic NimbusPost sync.
 * GET /api/cron/nimbus-sync
 *
 * Runs on the Vercel cron defined in vercel.json. Three jobs in one pass:
 *
 *  1. A staged DRAFT that someone booked in the NimbusPost dashboard has an AWB
 *     there and none here. Until it is pulled across, the customer gets no
 *     tracking link and the status webhook — which matches on AWB — can never
 *     find the order. This is what used to require pressing "Sync" by hand.
 *  2. A booked shipment gets its latest courier scan pulled in, so the status
 *     shown in the admin and on the customer's timeline keeps up on its own.
 *  3. **The same two things for the reverse leg** — a return pickup. This half
 *     was missing, so a reverse shipment only ever moved when somebody pressed
 *     "Sync pickups": the parcel could be collected, be in transit and arrive,
 *     and the return would still read "approved" until a human looked. Both
 *     legs are polled in one pass because they are the same parcel's journey.
 *
 * The two are independent: a forward failure must not stop the reverse sweep,
 * so each reports separately and neither can throw the other away.
 *
 * Auth: Vercel sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is
 * set on the project. Without the env var the route refuses everything rather
 * than sitting open — this endpoint spends money's worth of API quota.
 */

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { syncAllOpenOrders } from "@/lib/fulfilment";
import { syncAllOpenReturns } from "@/lib/nimbus-returns";

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

  // `allSettled`, not `all`: one leg failing is not a reason to abandon the
  // other, and a rejected promise here would lose a completed sweep's results.
  const [forward, reverse] = await Promise.allSettled([
    syncAllOpenOrders(),
    syncAllOpenReturns(),
  ]);

  const result =
    forward.status === "fulfilled"
      ? forward.value
      : { ok: false as const, error: String(forward.reason) };
  const returns =
    reverse.status === "fulfilled"
      ? reverse.value
      : { ok: false as const, error: String(reverse.reason) };

  if (!result.ok) {
    // A disabled or unconfigured integration is not a failure worth retrying.
    console.log("[nimbus-sync] forward skipped:", result.error);
  } else {
    console.log(
      `[nimbus-sync] checked ${result.checked} · ${result.booked} newly booked · ${result.tracked} tracked · ${result.waiting} awaiting booking · ${result.failed} failed`
    );
  }

  if (!returns.ok) {
    console.log("[nimbus-sync] reverse skipped:", returns.error);
  } else {
    console.log(`[nimbus-sync] returns: ${JSON.stringify(returns)}`);
  }

  // Both legs feed the same two screens, so one changed row on either is
  // reason enough to revalidate.
  const forwardMoved = result.ok && (result.booked || result.tracked);
  const reverseMoved = returns.ok;
  if (forwardMoved || reverseMoved) {
    try {
      revalidatePath("/admin/orders");
      revalidatePath("/admin/returns");
      revalidatePath("/admin");
    } catch {
      // revalidatePath can throw outside a request context on some runtimes.
    }
  }

  // 200 even when one leg skipped: a disabled integration is a configuration
  // state, not an error the cron should retry into.
  return NextResponse.json({ forward: result, returns });
}
