/**
 * Bazaro — every icon size, generated from the one logo.
 *
 *   node scripts/brand-icons.mjs
 *
 * The source is public/brand/bazaro-logo.png and it is never redesigned
 * here: each output is the same artwork resized, fitted inside its box
 * with transparent padding so nothing is cropped and the proportions
 * never change.
 *
 * The share card is the exception, and only because it has to be: a
 * social preview is a 1200x630 landscape frame, and a square logo
 * dropped into it would be stretched. The logo is centred on the app's
 * own background colour instead.
 *
 * Outputs are generated, not authored. They are committed so a deploy
 * does not depend on this script having been run, and
 * scripts/brand-assets-test.mjs fails if any of them is missing.
 */
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const SRC = 'public/brand/bazaro-logo.png';
const OUT = 'public/brand';
const BACKGROUND = '#FBF9F6';           // --surface, the app's own ground

if (!existsSync(SRC)) {
  console.error(`\nMissing ${SRC}\n\nPut the official Bazaro logo there and run this again.\n`);
  process.exit(1);
}

await mkdir(OUT, { recursive: true });

const meta = await sharp(SRC).metadata();
console.log(`source: ${meta.width}x${meta.height} ${meta.format}`);

/** The logo fitted inside a square, padded rather than cropped. */
const square = (size) => sharp(SRC)
  .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png();

const squares = [
  ['favicon-16.png', 16],
  ['favicon-32.png', 32],
  ['favicon-48.png', 48],
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
];

for (const [name, size] of squares) {
  await square(size).toFile(`${OUT}/${name}`);
  console.log(`  ${name} ${size}x${size}`);
}

// Apple refuses transparency and renders it black, so the touch icon
// gets the app's background rather than an alpha channel.
await sharp(SRC)
  .resize(180, 180, { fit: 'contain', background: BACKGROUND })
  .flatten({ background: BACKGROUND })
  .png()
  .toFile(`${OUT}/apple-touch-icon.png`);
console.log('  apple-touch-icon.png flattened onto ' + BACKGROUND);

// The share card: the logo centred in a 1200x630 landscape frame.
await sharp({
  create: { width: 1200, height: 630, channels: 4,
            background: BACKGROUND },
})
  .composite([{
    input: await sharp(SRC)
      .resize(420, 420, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png().toBuffer(),
    gravity: 'centre',
  }])
  .png()
  .toFile(`${OUT}/og-default.png`);
console.log('  og-default.png 1200x630');

/**
 * favicon.ico, built by hand.
 *
 * sharp does not write ICO, and the format is simple enough not to
 * warrant a dependency: a 6-byte header, one 16-byte directory entry
 * per image, then the PNG bytes. Modern Windows reads PNG-in-ICO.
 */
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map((s) => square(s).toBuffer()));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);              // reserved
header.writeUInt16LE(1, 2);              // 1 = icon
header.writeUInt16LE(sizes.length, 4);

let offset = 6 + 16 * sizes.length;
const entries = sizes.map((size, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(size === 256 ? 0 : size, 0);   // width, 0 means 256
  e.writeUInt8(size === 256 ? 0 : size, 1);   // height
  e.writeUInt8(0, 2);                          // palette
  e.writeUInt8(0, 3);                          // reserved
  e.writeUInt16LE(1, 4);                       // colour planes
  e.writeUInt16LE(32, 6);                      // bits per pixel
  e.writeUInt32LE(images[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += images[i].length;
  return e;
});

await writeFile('public/favicon.ico', Buffer.concat([header, ...entries, ...images]));
console.log(`  favicon.ico ${sizes.join(', ')}`);
console.log('\ndone');
