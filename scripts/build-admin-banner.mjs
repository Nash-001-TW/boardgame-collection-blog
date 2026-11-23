/**
 * Convert public/images/cat-adventure-banner.png into the Admin header assets:
 * public/images/admin/banner-1600.webp for desktop and banner-800.webp as the
 * mobile crop source. Keep the full image so the preview can set the crop.
 * sharp is already available as an indirect dependency of miniflare.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const source = fileURLToPath(new URL('../public/images/cat-adventure-banner.png', import.meta.url));
const outputDirectory = new URL('../public/images/admin/', import.meta.url);
const maxBytes = 250_000;

await mkdir(outputDirectory, { recursive: true });

for (const width of [1600, 800]) {
  const output = new URL(`banner-${width}.webp`, outputDirectory);
  // Encode in memory so an oversized candidate never replaces a valid banner.
  for (let quality = 88; quality >= 1; quality -= 1) {
    const { data, info } = await sharp(source)
      .resize({ width })
      .webp({ quality })
      .toBuffer({ resolveWithObject: true });

    if (data.length > maxBytes) {
      if (quality === 1) {
        throw new Error(`banner-${width}.webp exceeds ${maxBytes} bytes at quality 1`);
      }
      continue;
    }

    await writeFile(output, data);
    console.log(`banner-${width}.webp: ${info.width}x${info.height}, ${data.length} bytes, quality ${quality}`);
    break;
  }
}
