import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { getAdminSession } from "@/lib/auth";
import { slugify } from "@/lib/utils";
import {
  getChatIdentity,
  hasIdentity,
  identityKey,
  rateLimit,
  signAttachment,
  UPLOAD_LIMIT,
  validateUpload,
} from "@/lib/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Chat attachments.
 *
 * Same storage, same `put()` from @vercel/blob, same `BLOB_READ_WRITE_TOKEN`
 * as `src/app/api/upload/route.ts` — this is not a second upload mechanism.
 * It is a separate *entry point* for two reasons that route cannot serve:
 *
 * 1. That route is admin-only, and the whole point here is that a customer
 *    can send a photo of a print defect.
 * 2. That route writes a `Media` row, which is the product photo library. A
 *    shopper's screenshot must never turn up in the admin's product image
 *    picker, so chat files are written under a `chat/` prefix and left out of
 *    that table entirely.
 *
 * The response carries a signature over (url, name, type). A send is rejected
 * without it, so nobody can attach a URL this server did not produce.
 */
export async function POST(req: Request) {
  const admin = await getAdminSession();

  // Guests are legitimate senders here. `create: false` because a caller who
  // has not opened the chat yet has no business uploading: the widget always
  // polls (which mints the cookie) before it can show a paperclip.
  const identity = admin ? null : await getChatIdentity();
  if (!admin && (!identity || !hasIdentity(identity))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limitKey = admin ? `a:${admin.id}` : identityKey(identity!);
  if (!rateLimit(`chat:upload:${limitKey}`, UPLOAD_LIMIT.limit, UPLOAD_LIMIT.windowMs)) {
    return NextResponse.json(
      { error: "Too many uploads just now. Try again shortly." },
      { status: 429 }
    );
  }

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // The browser checks these too, for a fast error. This is the check that
    // counts — a hand-rolled POST never runs the browser's.
    //
    // Deliberately ahead of the storage-config check: "that file type isn't
    // supported" is the true and useful answer whether or not a blob store is
    // wired up, and it keeps the rule testable in an environment without one.
    const check = validateUpload({
      name: file.name,
      type: file.type,
      size: file.size,
    });
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: 400 });
    }

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json(
        { error: "File sharing is not configured on this store yet." },
        { status: 400 }
      );
    }

    const base = slugify(check.value.name.replace(/\.[^.]+$/, "")) || "file";
    const key = `chat/${base}-${Date.now()}.${check.value.ext}`;

    const blob = await put(key, file, {
      access: "public",
      addRandomSuffix: true,
      contentType: check.value.type,
    });

    const attachment = {
      url: blob.url,
      name: check.value.name,
      type: check.value.type,
    };
    return NextResponse.json({
      ...attachment,
      size: file.size,
      token: signAttachment(attachment),
    });
  } catch (err) {
    console.error("[chat/upload] error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
