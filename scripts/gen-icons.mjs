// Regenerates every derived app icon from a single source logo.
//
//   1. Replace  public/icons/icon-512.png  with your 512x512 PNG logo.
//   2. Run      npm run icons
//
// From that one file this writes: icon-192, icon-maskable-512 (padded safe zone),
// apple-touch-icon (180, opaque), and badge-72 (monochrome white glyph on
// transparent, for the Android notification small-icon). favicon.svg is authored
// by hand (a simplified single shape that stays legible at 16px) and only
// rasterised to favicon-32.png here.
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const icons = join(root, 'public', 'icons');
const SRC = join(icons, 'icon-512.png');

// The logo's background colour: average of the opaque border ring, falling back
// to the centre pixel when the border is transparent (e.g. a rounded logo).
async function bgColor() {
  const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  const at = (x, y) => { const i = (y * w + x) * c; return [data[i], data[i + 1], data[i + 2], data[i + 3]]; };
  let r = 0, g = 0, b = 0, n = 0;
  const step = Math.max(1, Math.floor(w / 64));
  for (let x = 0; x < w; x += step) { for (const y of [0, h - 1]) { const p = at(x, y); if (p[3] > 200) { r += p[0]; g += p[1]; b += p[2]; n++; } } }
  for (let y = 0; y < h; y += step) { for (const x of [0, w - 1]) { const p = at(x, y); if (p[3] > 200) { r += p[0]; g += p[1]; b += p[2]; n++; } } }
  if (n < 8) { const cpx = at(w >> 1, h >> 1); return { r: cpx[0], g: cpx[1], b: cpx[2] }; }
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}

async function main() {
  const bg = await bgColor();

  // Standard square (kept with its own alpha).
  await sharp(SRC).resize(192, 192).png().toFile(join(icons, 'icon-192.png'));

  // Maskable: logo at ~80% on a solid tile so nothing is clipped by a circle mask.
  const inner = 410;
  const scaled = await sharp(SRC).resize(inner, inner, { fit: 'contain', background: { ...bg, alpha: 1 } }).png().toBuffer();
  await sharp({ create: { width: 512, height: 512, channels: 4, background: { ...bg, alpha: 1 } } })
    .composite([{ input: scaled, gravity: 'center' }]).png().toFile(join(icons, 'icon-maskable-512.png'));

  // Apple touch icon: opaque (iOS ignores transparency), flattened onto the bg.
  await sharp(SRC).flatten({ background: bg }).resize(180, 180).png().toFile(join(icons, 'apple-touch-icon.png'));

  // Notification badge: white silhouette of the bright glyph on transparent.
  const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const bright = (data[i] + data[i + 1] + data[i + 2]) / 3;
    const on = data[i + 3] > 60 && bright > 170;
    out[i] = out[i + 1] = out[i + 2] = 255;
    out[i + 3] = on ? 255 : 0;
  }
  await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
    .resize(72, 72).png().toFile(join(icons, 'badge-72.png'));

  // Favicon raster from the hand-authored simplified shape.
  const favSvg = join(icons, 'favicon.svg');
  await sharp(favSvg).resize(32, 32).png().toFile(join(icons, 'favicon-32.png'));

  console.log('icons regenerated (bg', `rgb(${bg.r},${bg.g},${bg.b})`, ')');
}

main().catch((e) => { console.error(e); process.exit(1); });
