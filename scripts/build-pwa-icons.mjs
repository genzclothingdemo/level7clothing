/**
 * Generates the PWA / home-screen icon set into `public/icons`.
 *
 * The "L7" mark is drawn as vector rectangles rather than SVG <text>, because
 * the rasteriser resolves fonts from the host OS — using text would render
 * differently (or not at all) depending on whether Space Grotesk happens to be
 * installed on the machine that ran the build.
 *
 * Run with: npm run pwa:icons
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const OUT_DIR = path.join(process.cwd(), "public", "icons");

// Design-system colours (see CLAUDE.md): monochrome ink + electric violet.
const INK = "#0a0a0a";
const VIOLET = "#7c3aed";

/**
 * @param {number} scale  Glyph scale about the canvas centre. Maskable icons
 *   get a smaller glyph so it survives a circular crop — Android masks the
 *   outer ~20%, and anything in that band can be cut off.
 */
function markSvg(scale) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${INK}"/>
  <g transform="translate(256 256) scale(${scale}) translate(-278 -256)" fill="${VIOLET}">
    <rect x="140" y="160" width="44" height="192"/>
    <rect x="140" y="308" width="120" height="44"/>
    <rect x="286" y="160" width="130" height="44"/>
    <polygon points="416,204 372,204 300,352 344,352"/>
  </g>
</svg>`;
}

/** Full-bleed square, used for every icon; launchers apply their own masking. */
const STANDARD = Buffer.from(markSvg(1));
const MASKABLE = Buffer.from(markSvg(0.72));

const TARGETS = [
  { file: "icon-192.png", size: 192, src: STANDARD },
  { file: "icon-512.png", size: 512, src: STANDARD },
  { file: "icon-maskable-192.png", size: 192, src: MASKABLE },
  { file: "icon-maskable-512.png", size: 512, src: MASKABLE },
  // iOS ignores the manifest and reads this; it must be opaque (no alpha) or
  // Safari composites it onto black and the corners look wrong.
  { file: "apple-touch-icon.png", size: 180, src: STANDARD },
];

await mkdir(OUT_DIR, { recursive: true });

for (const { file, size, src } of TARGETS) {
  const png = await sharp(src)
    .resize(size, size)
    .flatten({ background: INK })
    .png()
    .toBuffer();
  await writeFile(path.join(OUT_DIR, file), png);
  console.log(`  wrote icons/${file} (${size}x${size})`);
}

console.log(`Generated ${TARGETS.length} PWA icons in public/icons`);
