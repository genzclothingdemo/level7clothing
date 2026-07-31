import { NextResponse } from "next/server";
import { getProductsBySlugs } from "@/lib/products";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let slugs: unknown;
  try {
    ({ slugs } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(slugs)) {
    return NextResponse.json({ error: "slugs must be an array" }, { status: 400 });
  }

  // Cap the batch so a tampered client can't ask for the whole catalogue.
  const clean = slugs
    .filter((s): s is string => typeof s === "string")
    .slice(0, 100);

  const products = await getProductsBySlugs(clean);
  return NextResponse.json({ products });
}
