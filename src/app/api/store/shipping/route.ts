import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { calculateShippingRate } from "@/lib/nimbuspost";

type RateItem = { productId: string; quantity?: number };

export async function POST(req: Request) {
  try {
    const { items, pincode, paymentType } = (await req.json()) as {
      items?: RateItem[];
      pincode?: string;
      paymentType?: string;
    };

    if (!pincode || !items || !items.length) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    const ids = items.map((i) => i.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, price: true, weightGrams: true, lengthCm: true, breadthCm: true, heightCm: true, shippingType: true, shippingFee: true, shippingMarkup: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    let totalShipping = 0;
    
    let nimbusWeight = 0;
    let nimbusLength = 0;
    let nimbusBreadth = 0;
    let nimbusHeight = 0;
    let nimbusMarkupTotal = 0;
    let hasNimbusProducts = false;
    let cartValue = 0;

    for (const it of items) {
      const p = byId.get(it.productId);
      if (!p) continue;

      const qty = it.quantity || 1;
      const type = p.shippingType || "nimbus";
      cartValue += (p.price || 0) * qty;

      if (type === "fixed") {
        totalShipping += (p.shippingFee || 0) * qty;
      } else if (type === "nimbus") {
        hasNimbusProducts = true;
        nimbusMarkupTotal += (p.shippingMarkup || 0) * qty;
        if (p.weightGrams) nimbusWeight += p.weightGrams * qty;
        if (p.lengthCm) nimbusLength = Math.max(nimbusLength, p.lengthCm);
        if (p.breadthCm) nimbusBreadth = Math.max(nimbusBreadth, p.breadthCm);
        if (p.heightCm) nimbusHeight = Math.max(nimbusHeight, p.heightCm);
      }
    }

    if (hasNimbusProducts && pincode && pincode.length >= 6) {
      const rate = await calculateShippingRate({
        destinationPincode: pincode,
        weightGrams: nimbusWeight,
        lengthCm: nimbusLength,
        breadthCm: nimbusBreadth,
        heightCm: nimbusHeight,
        paymentType: paymentType === "cod" ? "cod" : "prepaid",
        orderValueRupees: cartValue,
      });

      if (rate === null) {
        return NextResponse.json({ success: false, error: "Shipping not available for this pincode" }, { status: 400 });
      }
      totalShipping += rate + nimbusMarkupTotal;
    }

    return NextResponse.json({ success: true, rate: totalShipping });
  } catch (err) {
    console.error("Shipping API error:", err);
    return NextResponse.json({ success: false, error: "Failed to calculate shipping" }, { status: 500 });
  }
}
