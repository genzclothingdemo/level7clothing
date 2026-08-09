// Server-side only: touches the filesystem, Vercel Blob and the database.
import { readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { list } from "@vercel/blob";
import { prisma } from "./prisma";
import manifest from "./media-manifest.json";

/** Where a photo came from. All three are pickable and reusable alike. */
export type PhotoSource = "repo" | "blob" | "external";

/** One photo available to the picker. */
export type Photo = {
  /** Exactly the string stored on products — repo path or absolute URL. */
  url: string;
  file: string;
  /** Top folder under public/products, e.g. "level7"; a label otherwise. */
  category: string;
  /** Any folders below that, joined. Empty when the file sits one level down. */
  group: string;
  source: PhotoSource;
  size?: number;
};

/** Where a photo is currently attached. Detaching never deletes the file. */
export type PhotoUse = {
  kind: "product" | "subcategory" | "category";
  id: string;
  name: string;
};

export type MediaLibrary = {
  photos: Photo[];
  /** url → everything currently using it, so the same file is reused, not re-uploaded. */
  usage: Record<string, PhotoUse[]>;
};

const IMAGE_EXT = /\.(jpe?g|png|webp|avif|gif|svg)$/i;

// Level7's photos live flat in public/products/level7/, so the scan root is
// public/products — NOT public/products/gallery, which is an upstream-only
// folder that does not exist in this repo. Pointing at it silently returned an
// empty picker. Keep this in step with scripts/build-media-manifest.mjs.
function galleryDir() {
  return join(process.cwd(), "public", "products");
}

function describe(absPath: string): Photo {
  const rel = relative(galleryDir(), absPath).split(sep);
  return {
    url: encodeURI(`/products/${rel.join("/")}`),
    file: rel[rel.length - 1],
    category: rel.length >= 2 ? rel[0] : "",
    group: rel.length >= 3 ? rel.slice(1, -1).join(" / ") : "",
    source: "repo",
  };
}

async function walk(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (IMAGE_EXT.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Every photo in the repo.
 *
 * Reads the real folder when it is there (local dev — a photo dropped in shows
 * up on the next refresh, no rebuild) and otherwise falls back to the manifest
 * generated at build time, which is what production uses because `public/` is
 * not readable from Vercel's serverless filesystem.
 */
export async function listRepoPhotos(): Promise<Photo[]> {
  const files = await walk(galleryDir());
  if (files.length > 0) {
    const photos: Photo[] = [];
    for (const f of files.sort((a, b) => a.localeCompare(b))) {
      const info = describe(f);
      const size = await stat(f)
        .then((s) => s.size)
        .catch(() => undefined);
      photos.push({ ...info, size });
    }
    return photos;
  }
  return ((manifest.photos ?? []) as Photo[]).map((p) => ({
    ...p,
    source: "repo" as const,
  }));
}

/**
 * Everything in the Vercel Blob store — i.e. photos uploaded through the admin
 * "Upload" button. Listed straight from Blob rather than inferred from the
 * database, so an upload is pickable even before it is attached to anything.
 */
export async function listBlobPhotos(): Promise<Photo[]> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return [];
  try {
    const photos: Photo[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ cursor, limit: 1000 });
      for (const b of page.blobs) {
        if (!IMAGE_EXT.test(b.pathname)) continue;
        photos.push({
          url: b.url,
          file: b.pathname.split("/").pop() || b.pathname,
          category: "Uploaded",
          group: "",
          source: "blob",
          size: b.size,
        });
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return photos.sort((a, b) => a.file.localeCompare(b.file));
  } catch (err) {
    console.error("[media] blob listing failed:", err);
    return [];
  }
}

/**
 * Photos already attached to something but belonging to neither source —
 * image URLs pasted into the admin by hand. Included so the picker really is
 * every photo the store uses, and so a pasted URL can be reused elsewhere.
 */
async function listExternalPhotos(known: Set<string>): Promise<Photo[]> {
  try {
    const [products, subcategories, categories] = await Promise.all([
      prisma.product.findMany({ select: { images: true } }),
      prisma.subcategory.findMany({ select: { images: true } }),
      prisma.category.findMany({ select: { imageUrl: true } }),
    ]);
    const urls = new Set<string>([
      ...products.flatMap((p) => p.images),
      ...subcategories.flatMap((s) => s.images),
      ...categories.map((c) => c.imageUrl ?? ""),
    ]);
    return [...urls]
      .filter((u) => u && !known.has(u))
      .map((url) => ({
        url,
        file: decodeURIComponent(url.split("/").pop() ?? url).split("?")[0],
        category: "Pasted links",
        group: "",
        source: "external" as const,
      }));
  } catch {
    return [];
  }
}

/** Every photo the admin can pick from: repo + Blob uploads + pasted links. */
export async function listPhotos(): Promise<Photo[]> {
  const [repo, blob] = await Promise.all([listRepoPhotos(), listBlobPhotos()]);
  const known = new Set([...repo, ...blob].map((p) => p.url));
  const external = await listExternalPhotos(known);
  return [...repo, ...blob, ...external];
}

/** Build the url → users map so the picker can show "used by 2 products". */
export async function getPhotoUsage(): Promise<Record<string, PhotoUse[]>> {
  const usage: Record<string, PhotoUse[]> = {};
  const add = (url: string, use: PhotoUse) => {
    if (!url) return;
    (usage[url] ??= []).push(use);
  };

  try {
    const [products, subcategories, categories] = await Promise.all([
      prisma.product.findMany({ select: { id: true, name: true, images: true } }),
      prisma.subcategory.findMany({
        select: { id: true, name: true, images: true },
      }),
      prisma.category.findMany({
        select: { id: true, name: true, imageUrl: true },
      }),
    ]);

    for (const p of products)
      for (const url of p.images)
        add(url, { kind: "product", id: p.id, name: p.name });
    for (const s of subcategories)
      for (const url of s.images)
        add(url, { kind: "subcategory", id: s.id, name: s.name });
    for (const c of categories)
      if (c.imageUrl) add(c.imageUrl, { kind: "category", id: c.id, name: c.name });
  } catch (err) {
    console.error("[media] usage lookup failed:", err);
  }

  return usage;
}

export async function getMediaLibrary(): Promise<MediaLibrary> {
  const [photos, usage] = await Promise.all([listPhotos(), getPhotoUsage()]);
  return { photos, usage };
}
