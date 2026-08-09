// Builds a manifest of every photo committed under public/products.
//
// Why a manifest at all: on Vercel the contents of `public/` are served from
// the CDN and are NOT reliably readable from the serverless filesystem, so the
// admin photo picker cannot list the folder at request time in production.
// The manifest is generated during `npm run build` and imported like any other
// module, which always works.
//
// Locally we read the real folder instead (see src/lib/media.ts), so photos
// dropped into the repo show up in the picker straight away with no rebuild.
//
// Folder layout that gives the picker its grouping:
//   public/products/<Group>/<file>.png  (Level7: public/products/level7/*.png)

import { readdir, writeFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const ROOT = resolve(process.cwd());
const GALLERY = join(ROOT, "public", "products");
const OUT = join(ROOT, "src", "lib", "media-manifest.json");

const IMAGE_EXT = /\.(jpe?g|png|webp|avif|gif|svg)$/i;

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return []; // gallery folder absent — an empty library is fine
  }
  const out = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (IMAGE_EXT.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Turn an absolute file path into the {url, category, group, file} the picker wants. */
export function describe(absPath, galleryDir = GALLERY) {
  const rel = relative(galleryDir, absPath).split(sep);
  const file = rel[rel.length - 1];
  // <Category>/<Group>/file → category + group. Shallower paths degrade
  // gracefully: a file straight inside a category folder has no group.
  const category = rel.length >= 2 ? rel[0] : "";
  const group = rel.length >= 3 ? rel.slice(1, -1).join(" / ") : "";
  return {
    // Encoded because folder names contain spaces, and because this is exactly
    // the form already stored in the database.
    url: encodeURI(`/products/${rel.join("/")}`),
    file,
    category,
    group,
  };
}

async function main() {
  const files = (await walk(GALLERY)).sort((a, b) => a.localeCompare(b));
  const photos = [];
  for (const f of files) {
    const info = describe(f);
    const { size } = await stat(f);
    photos.push({ ...info, size });
  }
  await writeFile(OUT, JSON.stringify({ photos }, null, 2) + "\n", "utf8");
  console.log(`[media] wrote ${photos.length} photos → ${relative(ROOT, OUT)}`);
}

main().catch((err) => {
  console.error("[media] manifest build failed:", err);
  // A missing manifest must not break the deploy — the picker just shows empty.
  process.exit(0);
});
