import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const source = new URL("../desktop/assets/icon.svg", import.meta.url);
const svg = await fs.readFile(source);
// One vector master for the desktop, in-app mark and browser favicon.
await fs.copyFile(source, new URL("../public/mark.svg", import.meta.url));
await sharp(svg)
  .resize(512, 512)
  .png()
  .toFile(
    fileURLToPath(new URL("../desktop/assets/icon.png", import.meta.url)),
  );
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(
  sizes.map((size) => sharp(svg).resize(size, size).png().toBuffer()),
);
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (const [index, size] of sizes.entries()) {
  const entry = 6 + index * 16;
  header[entry] = header[entry + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(images[index].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[index].length;
}
await fs.writeFile(
  new URL("../desktop/assets/icon.ico", import.meta.url),
  Buffer.concat([header, ...images]),
);
console.log("Generated zemiCC app mark, PNG and multi-size Windows icon.");
