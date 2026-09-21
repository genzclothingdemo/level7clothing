import { NextResponse } from "next/server";
import { buildId } from "@/lib/build-id";

// Must never be cached or prerendered: the whole point is to report what *this
// deployment* is, right now. A cached response would report the old build
// forever and the update watcher would never fire.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return NextResponse.json(
    { id: buildId() },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "CDN-Cache-Control": "no-store",
        "Vercel-CDN-Cache-Control": "no-store",
      },
    }
  );
}
