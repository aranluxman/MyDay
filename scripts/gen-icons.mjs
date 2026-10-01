// Regenerates every app icon from the same mark the website shows
// (.mkt-brand__mark in src/glass.css): a blue-to-violet gradient tile with the
// white "pulse" line from src/components/Icon.jsx.
//
//   Run  npm run icons
//
// Change the colours or the glyph here and every size follows: icon-192/512
// (rounded tile on transparent), icon-maskable-512 and apple-touch-icon
// (full-bleed — Android and iOS cut their own shape), badge-72 (white glyph
// only, for the Android notification small-icon) and favicon.svg / favicon-32.
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const icons = join(root, 'public', 'icons');

// The website's gradient: linear-gradient(150deg, #5aa2ff, #0a6cff 60%, #7a4dff).
// 150deg in CSS runs from (0.25, 0.067) to (0.75, 0.933) of the box.
const GRADIENT = `<linearGradient id="g" x1="0.25" y1="0.067" x2="0.75" y2="0.933">
    <stop offset="0" stop-color="#5aa2ff"/><stop offset="0.6" stop-color="#0a6cff"/><stop offset="1" stop-color="#7a4dff"/>
  </linearGradient>
  <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#fff" stop-opacity="0.22"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>`;
const PULSE = 'M3 12h4l2 6 4-14 2 8h6';

// glyph: fraction of the tile the 24-unit icon spans (the site uses 22px in 36px).
function svg({ size = 512, radius = 0.305, glyph = 0.6, stroke = 2.3, tile = true, shine = true } = {}) {
  const g = size * glyph;
  const s = g / 24;
  const off = (size - g) / 2;
  const r = size * radius;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="MyDay">
  <defs>${GRADIENT}</defs>
  ${tile ? `<rect width="${size}" height="${size}" rx="${r}" fill="url(#g)"/>` : ''}
  ${tile && shine ? `<rect width="${size}" height="${size}" rx="${r}" fill="url(#shine)"/>` : ''}
  <path d="${PULSE}" transform="translate(${off} ${off}) scale(${s})" fill="none" stroke="#fff"
        stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

const png = (markup, size, file) =>
  sharp(Buffer.from(markup)).resize(size, size).png().toFile(join(icons, file));

async function main() {
  const rounded = svg();
  const fullBleed = svg({ radius: 0 });
  await png(rounded, 512, 'icon-512.png');
  await png(rounded, 192, 'icon-192.png');
  // Maskable: the glyph already sits inside the 80% safe circle.
  await png(fullBleed, 512, 'icon-maskable-512.png');
  await png(fullBleed, 180, 'apple-touch-icon.png');
  await png(svg({ tile: false, glyph: 0.84, stroke: 2.6 }), 72, 'badge-72.png');

  // Favicon: same tile, thicker line so it survives 16px.
  const fav = svg({ size: 32, radius: 0.28, glyph: 0.72, stroke: 3, shine: false });
  writeFileSync(join(icons, 'favicon.svg'), fav + '\n');
  await png(fav, 32, 'favicon-32.png');

  console.log('icons regenerated');
}

main().catch((e) => { console.error(e); process.exit(1); });
