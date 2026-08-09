import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { listRepoPhotos, listBlobPhotos, Photo } from "@/lib/media";

// Note: To be executed via cron or manually triggered.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    console.log("[media-migration] Starting Phase 1 sync...");

    // 1. Gather all existing media from the filesystem and Vercel Blob
    const [repo, blob] = await Promise.all([listRepoPhotos(), listBlobPhotos()]);
    
    // We also need external pasted links from the database strings
    const [products, subcategories, categories] = await Promise.all([
      prisma.product.findMany({ select: { id: true, images: true, variants: true } }),
      prisma.subcategory.findMany({ select: { id: true, images: true } }),
      prisma.category.findMany({ select: { id: true, imageUrl: true } }),
    ]);

    const allStringUrls = new Set<string>();
    
    for (const p of products) {
      p.images.forEach((url) => allStringUrls.add(url));
      // Extract from variants JSON
      try {
        const variantsArr = Array.isArray(p.variants) ? p.variants : JSON.parse(p.variants as string || "[]");
        variantsArr.forEach((v: any) => {
          if (v.images && Array.isArray(v.images)) {
            v.images.forEach((img: string) => allStringUrls.add(img));
          }
        });
      } catch (e) {
        // Ignore JSON parse errors for edge cases
      }
    }
    
    for (const s of subcategories) {
      s.images.forEach((url) => allStringUrls.add(url));
    }
    
    for (const c of categories) {
      if (c.imageUrl) allStringUrls.add(c.imageUrl);
    }

    // Build the photo catalog
    const allAvailablePhotos = [...repo, ...blob];
    const knownUrls = new Set(allAvailablePhotos.map(p => p.url));
    
    for (const url of Array.from(allStringUrls)) {
      if (!knownUrls.has(url)) {
        allAvailablePhotos.push({
          url,
          file: url.split("/").pop() || url,
          category: "Pasted links",
          group: "",
          source: "external",
        });
      }
    }

    // 2. Upsert into the new Media table
    const mediaMap = new Map<string, string>(); // url -> mediaId
    let mediaCreated = 0;

    // Deduplicate to prevent upsert unique constraint failures
    const uniquePhotos = new Map<string, Photo>();
    for (const p of allAvailablePhotos) {
      if (p.url) uniquePhotos.set(p.url, p);
    }

    for (const photo of uniquePhotos.values()) {
      // Upsert Media
      const record = await prisma.media.upsert({
        where: { url: photo.url },
        update: {},
        create: {
          url: photo.url,
          file: photo.file,
          source: photo.source,
          size: photo.size,
        }
      });
      mediaMap.set(photo.url, record.id);
      mediaCreated++;
    }

    // 3. Create ProductImage relationships
    let productImagesCreated = 0;
    for (const p of products) {
      let sortOrder = 0;
      // Common images
      for (const url of p.images) {
        const mediaId = mediaMap.get(url);
        if (!mediaId) continue;
        
        // We handle variantId nullable uniqueness in Prisma by allowing multiple ProductImage rows if needed,
        // but to avoid collisions on nulls, we just create. Wait, upsert with null is problematic in some DBs.
        // We can just findFirst and then create.
        const existing = await prisma.productImage.findFirst({
          where: { productId: p.id, mediaId, variantValue: null }
        });

        if (!existing) {
          await prisma.productImage.create({
            data: {
              productId: p.id,
              mediaId,
              variantValue: null,
              sortOrder,
            }
          });
          productImagesCreated++;
        }
        sortOrder++;
      }
    }

    return NextResponse.json({ 
      success: true, 
      mediaProcessed: mediaCreated,
      productImagesProcessed: productImagesCreated
    });
    
  } catch (err: any) {
    console.error("[media-migration] failed:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
