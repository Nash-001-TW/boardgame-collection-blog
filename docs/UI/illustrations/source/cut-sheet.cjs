// Cut the 4x4 sheet into tiles, remove the baked-in checkerboard by flood fill
// from the tile border (line art outlines stop the fill, so white fur survives),
// then export trial WebP + PNG at the design-system sizes.
const sharp = require(process.argv[2]);
const path = require('path');
const fs = require('fs');
const dir = path.dirname(process.argv[1]);
const src = path.join(dir, 'source.jpg');
const out = path.join(dir, 'out2');
const maskSrc = path.join(dir, 'source3.png');
fs.mkdirSync(out, { recursive: true });

const cols = [[2, 254], [258, 510], [514, 766], [770, 1022]];
const row4cols = [[2, 340], [342, 682], [684, 1022]];
const rows = [[18, 228], [260, 468], [538, 728], [778, 976]];
const tiles = [
  ['fn-dashboard', 0, 0, 'fn'], ['fn-collection', 0, 1, 'fn'], ['fn-sleeves', 0, 2, 'fn'], ['fn-components', 0, 3, 'fn'],
  ['fn-purchases', 1, 0, 'fn'], ['fn-dup-5b', 1, 1, 'fn'], ['fn-game-data', 1, 2, 'fn'], ['fn-alerts', 1, 3, 'fn'],
  ['empty-no-copy', 2, 0, 'empty'], ['empty-wishlist', 2, 1, 'empty'], ['empty-preorder', 2, 2, 'empty'], ['empty-no-count-a', 2, 3, 'empty'],
  ['empty-no-count-b', 3, 0, 'empty'], ['empty-no-result', 3, 1, 'empty'], ['empty-error', 3, 2, 'empty'],
];

const isBg = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b) < 14 && Math.min(r, g, b) > 196;

(async () => {
  const report = [];
  // Alpha from the user's background-removed PNG, upscaled onto the 1024 JPG.
  const mask = await sharp(maskSrc).ensureAlpha().extractChannel(3).resize(1024, 1024, { kernel: 'cubic' }).raw().toBuffer();
  for (const [name, row, col, kind] of tiles) {
    let [x0, x1] = (row === 3 ? row4cols : cols)[col]; const [y0, y1] = rows[row];
    if (row === 2 && col === 0) x0 = 28; // skip the 'B' section label
    const w = x1 - x0, h = y1 - y0;
    const { data } = await sharp(src).extract({ left: x0, top: y0, width: w, height: h })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const seen = new Uint8Array(w * h);
    const queue = [];
    const push = (x, y) => {
      const i = y * w + x;
      if (seen[i]) return;
      const p = i * 4;
      if (!isBg(data[p], data[p + 1], data[p + 2])) return;
      seen[i] = 1; queue.push(i);
    };
    // Mask mode: skip flood fill; alpha comes from the user's PNG.
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const a = mask[(y0 + y) * 1024 + (x0 + x)]; data[(y * w + x) * 4 + 3] = a; if (a < 8) seen[y * w + x] = 1; }
    if (false) for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
    if (false) for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
    while (queue.length) {
      const i = queue.pop(), x = i % w, y = (i - x) / w;
      if (x > 0) push(x - 1, y); if (x < w - 1) push(x + 1, y);
      if (y > 0) push(x, y - 1); if (y < h - 1) push(x, y + 1);
    }
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (seen[i]) { data[i * 4 + 3] = 0; continue; }
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const cw = maxX - minX + 1, ch = maxY - minY + 1;
    const cut = sharp(data, { raw: { width: w, height: h, channels: 4 } })
      .extract({ left: minX, top: minY, width: cw, height: ch });
    const [W, H] = kind === 'fn' ? [256, 256] : [480, 360];
    const pad = Math.round(Math.min(W, H) * 0.08);
    const fitted = await cut.png().toBuffer()
      .then(b => sharp(b).resize(W - pad * 2, H - pad * 2, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' }).png().toBuffer());
    const canvas = sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: fitted, gravity: 'center' }]);
    const png = await canvas.png().toBuffer();
    fs.writeFileSync(path.join(out, name + '.png'), png);
    const webp = await sharp(png).webp({ quality: 85, alphaQuality: 90, effort: 6 }).toBuffer();
    fs.writeFileSync(path.join(out, name + '.webp'), webp);
    const scale = Math.min((W - pad * 2) / cw, (H - pad * 2) / ch);
    report.push(`${name} src=${cw}x${ch} out=${W}x${H} upscale=${scale.toFixed(2)}x webp=${(webp.length / 1024).toFixed(1)}KB`);
  }
  console.log(report.join('\n'));
})();



