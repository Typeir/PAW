/**
 * PAW Icon Build
 *
 * @fileoverview Renders the console's paw mark into the desktop icon set:
 * `assets/paw-<size>.png` for 16-256px and `assets/paw.ico` packing all sizes
 * as PNG-embedded entries (valid since Vista; Explorer, taskbar, and
 * installers read it). The SVG is the titlebar mark composed onto its rounded
 * amber-tinted box, colors hard-coded to the dark-theme tokens — an icon
 * cannot read CSS variables. Run `npm run build:icons` after changing the
 * mark; outputs are committed, so consumers never need sharp installed.
 *
 * @module @paw/electron/build-icons
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const ACCENT = '#e79a3c';
const BOX = '#382f24';
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const GLYPH_SCALE = (256 * 0.74) / 13;
const GLYPH_OFFSET = (256 - 13 * GLYPH_SCALE) / 2;

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="58" fill="${BOX}"/>
  <g transform="translate(${GLYPH_OFFSET} ${GLYPH_OFFSET}) scale(${GLYPH_SCALE})">
    <circle cx="3" cy="3.4" r="1.5" fill="${ACCENT}"/>
    <circle cx="6.5" cy="2.4" r="1.5" fill="${ACCENT}"/>
    <circle cx="10" cy="3.4" r="1.5" fill="${ACCENT}"/>
    <path d="M6.5 6C4.6 6 3 7.4 3 9c0 1.6 1.4 2 3.5 2S10 10.6 10 9c0-1.6-1.6-3-3.5-3Z" fill="${ACCENT}"/>
  </g>
</svg>`;

/**
 * Pack PNG buffers into one ICO file body.
 *
 * @param {{ size: number; png: Buffer }[]} images - Rendered sizes.
 * @returns {Buffer} ICO file contents.
 */
function packIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  const blobs = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    blobs.push(png);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...blobs]);
}

const out = join(import.meta.dirname, 'assets');
mkdirSync(out, { recursive: true });
const images = [];
for (const size of SIZES) {
  const png = await sharp(Buffer.from(SVG)).resize(size, size).png().toBuffer();
  images.push({ size, png });
  writeFileSync(join(out, `paw-${size}.png`), png);
}
writeFileSync(join(out, 'paw.ico'), packIco(images));
console.log(`wrote assets/paw.ico + ${SIZES.length} png(s)`);
