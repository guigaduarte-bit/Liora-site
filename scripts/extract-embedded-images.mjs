import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const htmlPath = new URL('../index.html', import.meta.url);
const outputDir = new URL('../assets/images/', import.meta.url);
const html = await readFile(htmlPath, 'utf8');

const embeddedImage = /(?:^|[,{])\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))\s*:\s*(['"])(data:image\/(jpeg|png|webp|avif);base64,([A-Za-z0-9+/=]+))\4/gm;
const extensionFor = { jpeg: 'jpg', png: 'png', webp: 'webp', avif: 'avif' };
const images = [];

let match;
while ((match = embeddedImage.exec(html))) {
  const key = match[1] || match[2] || match[3];
  const mimeSubtype = match[6];
  const extension = extensionFor[mimeSubtype];
  const filename = `${key}.${extension}`;

  images.push({
    dataUri: match[5],
    filename,
    bytes: Buffer.from(match[7], 'base64'),
  });
}

if (images.length === 0) {
  throw new Error('No embedded images found in index.html');
}

await mkdir(outputDir, { recursive: true });

for (const image of images) {
  await writeFile(join(outputDir.pathname, image.filename), image.bytes);
}

let updatedHtml = html;
for (const image of images) {
  updatedHtml = updatedHtml.replaceAll(
    image.dataUri,
    `/assets/images/${image.filename}`,
  );
}

await writeFile(htmlPath, updatedHtml);

console.log(`Extracted ${images.length} images to assets/images.`);
