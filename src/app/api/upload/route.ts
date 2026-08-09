import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { getAdminSession } from "@/lib/auth";
import { slugify } from "@/lib/utils";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error:
          "Image storage is not configured. Add a Vercel Blob store and set BLOB_READ_WRITE_TOKEN. You can also paste an image URL instead.",
      },
      { status: 400 }
    );
  }

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const ext = file.name.split(".").pop() || "jpg";
    const base = slugify(file.name.replace(/\.[^.]+$/, "")) || "image";
    const key = `products/${base}-${Date.now()}.${ext}`;

    const blob = await put(key, file, {
      access: "public",
      addRandomSuffix: true,
    });

    // Record the upload in the Media library so it shows up in the picker and
    // admin library. Upsert keyed on the (unique) blob URL keeps this idempotent.
    const media = await prisma.media.upsert({
      where: { url: blob.url },
      update: {},
      create: {
        url: blob.url,
        file: file.name,
        source: "blob",
        size: file.size || undefined,
      },
    });

    return NextResponse.json({ url: blob.url, id: media.id, file: media.file });
  } catch (err) {
    console.error("[upload] error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
