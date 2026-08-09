import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { del } from "@vercel/blob";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    // This endpoint DELETES media rows and their blobs, so it must never be
    // callable by an anonymous request. Refusing when CRON_SECRET is unset is
    // deliberate: an unset secret used to leave the route wide open.
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      return NextResponse.json(
        { error: "CRON_SECRET is not configured; purge is disabled" },
        { status: 503 }
      );
    }
    if (req.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Orphans = media no product photo references. ProductImage is the only
    // join table; subcategory covers are plain URLs on `Subcategory.images`.
    const orphans = await prisma.media.findMany({
      where: {
        productImages: { none: {} },
      }
    });

    if (orphans.length === 0) {
      return NextResponse.json({ success: true, purged: 0 });
    }

    let deletedBlobs = 0;
    const deletedDbIds: string[] = [];

    // 2. Delete from Vercel Blob (only if source === 'blob')
    for (const media of orphans) {
      if (media.source === "blob") {
        try {
          await del(media.url);
          deletedBlobs++;
        } catch (e) {
          console.error(`Failed to delete blob: ${media.url}`, e);
          continue; // skip DB deletion if blob delete fails so we can try next time
        }
      }
      deletedDbIds.push(media.id);
    }

    // 3. Delete from database
    if (deletedDbIds.length > 0) {
      await prisma.media.deleteMany({
        where: { id: { in: deletedDbIds } }
      });
    }

    return NextResponse.json({ 
      success: true, 
      purgedDb: deletedDbIds.length,
      purgedBlobs: deletedBlobs 
    });
  } catch (err: any) {
    console.error("[api/cron/purge-media] failed:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
