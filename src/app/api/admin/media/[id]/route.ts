import { NextResponse } from "next/server";
import { z } from "zod";
import { del } from "@vercel/blob";
import { getAdminSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  alt:              z.string().nullable().optional(),
  variantAttribute: z.string().nullable().optional(),
  variantValue:     z.string().nullable().optional(),
  subcategoryName:  z.string().nullable().optional(),
  roles:            z.array(z.string()).optional(),
  tags:             z.array(z.string()).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });

  try {
    const updated = await prisma.media.update({
      where: { id },
      data: parsed.data,
    });
    return NextResponse.json({ ok: true, media: updated });
  } catch (err) {
    console.error("[api/admin/media/[id]] PATCH failed:", err);
    return NextResponse.json({ error: "Could not update media" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const media = await prisma.media.findUnique({ where: { id } });
    if (!media) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // ProductImage / SubcategoryImage reference Media with onDelete: Restrict,
    // so this throws a foreign-key error if the image is still in use.
    await prisma.media.delete({ where: { id } });

    // Best-effort cleanup of the backing Blob object (mirrors purge-media cron).
    if (media.source === "blob") {
      try {
        await del(media.url);
      } catch (e) {
        console.error("[api/admin/media/[id]] blob delete failed:", e);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    // Foreign-key restrict violation → the image is referenced by a product/subcategory.
    const code = (err as { code?: string }).code;
    if (code === "P2003" || code === "P2014") {
      return NextResponse.json(
        { error: "This image is in use by a product/subcategory and can't be deleted." },
        { status: 409 }
      );
    }
    console.error("[api/admin/media/[id]] DELETE failed:", err);
    return NextResponse.json({ error: "Could not delete media" }, { status: 500 });
  }
}
