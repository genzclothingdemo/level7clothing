import { NextResponse } from "next/server";
import { getUserSession } from "@/lib/user-auth";
import { priceCartLines, validateCoupon } from "@/lib/coupons";

/**
 * Quote a discount for the cart, before checkout.
 *
 * Every rule lives in `@/lib/coupons`; this handler only gathers the inputs.
 * The number it returns is the number `placeOrder` will arrive at from the same
 * cart, because both call `validateCoupon` — the drift between an "Apply" that
 * says ₹300 and a checkout that charges ₹0 was the whole problem.
 *
 * Two things it deliberately does not trust:
 *  - **the browser's prices.** Only `productId`, `quantity` and the chosen
 *    options are read; every unit price is looked up again server-side.
 *  - **the browser's identity.** `perUserLimit` is counted against the session
 *    cookie, never against an email in the request body.
 *
 * The response shape (`success` / `discountAmount` / `code` / `error`) is what
 * the checkout client already reads, so it is kept exactly.
 */

/** HTTP status for each refusal — 404 only for a code that does not exist. */
const STATUS: Record<string, number> = {
  not_found: 404,
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { code?: unknown; items?: unknown };

    const code = typeof body.code === "string" ? body.code : "";
    if (!code.trim()) {
      return NextResponse.json(
        { success: false, error: "Enter a discount code." },
        { status: 400 }
      );
    }

    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) {
      return NextResponse.json(
        { success: false, error: "Your cart is empty." },
        { status: 400 }
      );
    }

    // Signed-in shoppers only for the per-person count; a guest quote simply
    // has no prior uses to find, and checkout requires a login anyway.
    const user = await getUserSession().catch(() => null);

    const lines = await priceCartLines(items);
    const result = await validateCoupon({
      code,
      lines,
      userId: user?.id ?? null,
      email: user?.email ?? null,
    });

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.message, reason: result.reason },
        { status: STATUS[result.reason] ?? 400 }
      );
    }

    return NextResponse.json({
      success: true,
      code: result.code,
      discountAmount: result.discount,
      eligibleSubtotal: result.eligibleSubtotal,
      wholeCart: result.wholeCart,
    });
  } catch (error) {
    console.error("[coupons] validate failed:", error);
    return NextResponse.json(
      { success: false, error: "Couldn't check that code. Please try again." },
      { status: 500 }
    );
  }
}
