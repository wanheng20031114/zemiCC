import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { ImageStore } from "../server/images.js";
import { MAX_UPLOAD_BYTES } from "../shared/images.js";
import type { Entry } from "../shared/types.js";

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zemicc-images-"));
  const images = new ImageStore(dir);
  await images.init();
  return {
    dir,
    images,
    close: () => fs.rm(dir, { recursive: true, force: true }),
  };
}
const pixels = () =>
  sharp({
    create: { width: 32, height: 24, channels: 3, background: "#345678" },
  });

test("raster uploads decode, remove metadata, normalize orientation and bound dimensions", async () => {
  const f = await fixture();
  try {
    for (const format of ["png", "jpeg", "webp", "gif"] as const) {
      const input = await pixels().toFormat(format).toBuffer();
      const attachment = await f.images.upload(
        input,
        `C:\\private\\photo.${format}`,
      );
      assert.equal(attachment.name, `photo.${format}`);
      const stored = await f.images.read(attachment.id);
      const decoded = await sharp(
        Buffer.from(stored.data, "base64"),
      ).metadata();
      assert.equal(decoded.format, "png");
      assert.equal(decoded.width, 32);
      assert.equal(decoded.height, 24);
      assert.equal(decoded.exif, undefined);
    }
    const rotated = await f.images.upload(
      await pixels().jpeg().withMetadata({ orientation: 6 }).toBuffer(),
      "portrait.jpg",
    );
    assert.equal(rotated.width, 24);
    assert.equal(rotated.height, 32);
    const large = await sharp({
      create: { width: 5000, height: 10, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    assert.equal((await f.images.upload(large, "wide.png")).width, 2560);
  } finally {
    await f.close();
  }
});

test("uploads reject vectors, corrupt rasters, oversized bodies and non-opaque references", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      f.images.upload(
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
        ),
        "fake.png",
      ),
      /图片无法读取/,
    );
    await assert.rejects(
      f.images.upload(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        "broken.png",
      ),
      /图片无法读取/,
    );
    await assert.rejects(
      f.images.upload(Buffer.alloc(MAX_UPLOAD_BYTES + 1), "large.png"),
      /20 MB/,
    );
    for (const id of [
      "../workspace",
      "C:\\secret",
      "https://example.org/image.png",
    ])
      await assert.rejects(f.images.read(id), /图片不存在/);
    await assert.rejects(f.images.resolve("file.png"), /最多/);
    await assert.rejects(f.images.resolve(Array(6).fill("id")), /最多/);
  } finally {
    await f.close();
  }
});

test("restore carries recent historical pixels with labels, prioritizes current images and reports unavailable ones", async () => {
  const f = await fixture();
  try {
    const input = await pixels().png().toBuffer();
    const refs = await Promise.all(
      Array.from({ length: 6 }, (_, i) => f.images.upload(input, `${i}.png`)),
    );
    const previous: Entry[] = refs.slice(0, 5).map((image, i) => ({
      id: String(i),
      kind: "user",
      text: `request ${i}`,
      time: i,
      images: [image],
    }));
    const current = await f.images.resolve([refs[5].id]);
    const prompt = await f.images.prompt("latest request", current, previous);
    assert.ok(Array.isArray(prompt));
    assert.equal(prompt.filter((b) => b.type === "image").length, 5);
    assert.ok(
      prompt.some(
        (b) => b.type === "text" && b.text === "Historical image: 1.png",
      ),
    );
    assert.ok(
      !prompt.some(
        (b) => b.type === "text" && b.text === "Historical image: 0.png",
      ),
    );
    assert.equal(prompt.at(-1)?.type, "image");
    await f.images.remove([refs[4].id]);
    const missing = await f.images.prompt("continue", [], previous);
    assert.ok(Array.isArray(missing));
    assert.ok(
      missing.some(
        (b) =>
          b.type === "text" &&
          b.text.includes("Historical image unavailable: 4.png"),
      ),
    );
    await f.images.prune(new Set([refs[5].id]));
    assert.equal((await fs.readdir(f.images.directory)).length, 1);
    assert.equal((await f.images.read(refs[5].id)).attachment.id, refs[5].id);
  } finally {
    await f.close();
  }
});

test("restore includes a reused attachment only once, including when it is attached to the current request", async () => {
  const f = await fixture();
  try {
    const image = await f.images.upload(
      await pixels().png().toBuffer(),
      "reused.png",
    );
    const previous: Entry[] = Array.from({ length: 5 }, (_, i) => ({
      id: String(i),
      kind: "user",
      text: `request ${i}`,
      time: i,
      images: [image],
    }));
    for (const current of [[], await f.images.resolve([image.id])]) {
      const prompt = await f.images.prompt("continue", current, previous);
      assert.ok(Array.isArray(prompt));
      assert.equal(
        prompt.filter((block) => block.type === "image").length,
        1,
        "Restoring the same immutable attachment must not resend its pixels repeatedly",
      );
      assert.ok(
        prompt.some(
          (block) => block.type === "text" && block.text.includes("request 0"),
        ),
      );
      if (current.length) assert.equal(prompt.at(-1)?.type, "image");
    }
  } finally {
    await f.close();
  }
});
