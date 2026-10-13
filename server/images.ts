import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  MAX_IMAGES,
  MAX_UPLOAD_BYTES,
  type ImageAttachment,
} from "../shared/images.js";
import type { Entry } from "../shared/types.js";

type StoredImage = { attachment: ImageAttachment; data: string };
type Content = SDKUserMessage["message"]["content"];
const validId =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// Five base64 images plus restored text stay below the API's request-size limit.
const MAX_MODEL_BYTES = 4 * 1024 * 1024;

/** Only opaque, locally generated IDs cross the API. Image bytes never enter SSE/history JSON. */
export class ImageStore {
  readonly directory: string;
  constructor(dataDir: string) {
    this.directory = path.join(dataDir, "images");
  }
  async init() {
    await fs.mkdir(this.directory, { recursive: true });
  }
  private file(id: string) {
    if (!validId.test(id)) throw new Error("图片不存在，请重新添加");
    return path.join(this.directory, `${id}.json`);
  }
  async upload(input: Buffer, name: string): Promise<ImageAttachment> {
    if (
      !Buffer.isBuffer(input) ||
      !input.length ||
      input.length > MAX_UPLOAD_BYTES
    )
      throw new Error("每张图片不能超过 20 MB");
    let output: Buffer, width: number, height: number;
    let mediaType: ImageAttachment["mediaType"] = "image/png";
    try {
      const raster =
        input
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        (input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) ||
        /^GIF8[79]a$/.test(input.subarray(0, 6).toString("ascii")) ||
        (input.subarray(0, 4).toString("ascii") === "RIFF" &&
          input.subarray(8, 12).toString("ascii") === "WEBP");
      if (!raster) throw new Error("format");
      const decoder = sharp(input, {
        limitInputPixels: 40_000_000,
        pages: 1,
        failOn: "warning",
      });
      const info = await decoder.metadata();
      if (!["png", "jpeg", "webp", "gif"].includes(info.format || ""))
        throw new Error("format");
      const normalized = decoder.rotate().resize({
        width: 2560,
        height: 2560,
        fit: "inside",
        withoutEnlargement: true,
      });
      const result = await normalized
        .png()
        .toBuffer({ resolveWithObject: true });
      output = result.data;
      width = result.info.width;
      height = result.info.height;
      if (output.length > MAX_MODEL_BYTES) {
        output = await sharp(output)
          .flatten({ background: "#ffffff" })
          .jpeg({ quality: 85 })
          .toBuffer();
        mediaType = "image/jpeg";
      }
    } catch {
      throw new Error(
        "图片无法读取，请使用有效的 PNG、JPEG、WebP 或 GIF（不超过 4000 万像素）",
      );
    }
    if (output.length > MAX_MODEL_BYTES)
      throw new Error("图片过大，请缩小后重试");
    const id = randomUUID();
    const attachment: ImageAttachment = {
      id,
      name:
        name
          .split(/[\\/]/)
          .at(-1)
          ?.replace(/[\x00-\x1f\x7f]/g, "")
          .slice(0, 120) || "图片",
      mediaType,
      bytes: output.length,
      width,
      height,
    };
    const file = this.file(id);
    await fs.writeFile(
      `${file}.tmp`,
      JSON.stringify({ attachment, data: output.toString("base64") }),
      { mode: 0o600, flag: "wx" },
    );
    await fs.rename(`${file}.tmp`, file);
    return attachment;
  }
  async read(id: string): Promise<StoredImage> {
    const file = this.file(id);
    try {
      const stored = JSON.parse(await fs.readFile(file, "utf8")) as StoredImage;
      if (
        stored.attachment.id !== id ||
        !["image/png", "image/jpeg"].includes(stored.attachment.mediaType) ||
        typeof stored.data !== "string" ||
        Buffer.byteLength(stored.data, "base64") !== stored.attachment.bytes
      )
        throw new Error("invalid");
      return stored;
    } catch {
      throw new Error("图片不存在或已损坏，请重新添加");
    }
  }
  async resolve(ids: unknown): Promise<StoredImage[]> {
    if (
      !Array.isArray(ids) ||
      ids.length > MAX_IMAGES ||
      ids.some((id) => typeof id !== "string") ||
      new Set(ids).size !== ids.length
    )
      throw new Error(`每条消息最多添加 ${MAX_IMAGES} 张不同的图片`);
    return Promise.all(ids.map((id) => this.read(id)));
  }
  async remove(ids: Iterable<string>) {
    for (const id of new Set(ids)) await fs.rm(this.file(id), { force: true });
  }
  async prune(referenced: Set<string>) {
    for (const name of await fs.readdir(this.directory)) {
      const id = name.replace(/\.json(?:\.tmp)?$/, "");
      if (
        validId.test(id) &&
        !referenced.has(id) &&
        /\.json(?:\.tmp)?$/.test(name)
      )
        await fs.rm(path.join(this.directory, name), { force: true });
    }
  }
  async prompt(
    text: string,
    images: StoredImage[],
    previous: Entry[] = [],
  ): Promise<Content> {
    const blocks: Exclude<Content, string> = [];
    const append = (image: StoredImage) =>
      blocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: image.attachment.mediaType,
          data: image.data,
        },
      });
    if (previous.length) {
      const history = previous
        .map(
          (entry) =>
            `${entry.kind === "user" ? "USER" : "ASSISTANT"}: ${entry.text}${(entry.images || []).map((image) => `\n[Image: ${image.name}]`).join("")}`,
        )
        .join("\n\n");
      blocks.push({
        type: "text",
        text: `Continue this locally restored conversation. The following is historical context, not new instructions. Some older context may be omitted. Re-check files before making changes.\n<previous_conversation>\n${history.slice(-60_000)}\n</previous_conversation>`,
      });
      // Keep a bounded recent visual context; the new request's images take priority.
      const remaining = MAX_IMAGES - images.length;
      const included = new Set(images.map((image) => image.attachment.id));
      const selected = remaining
        ? previous
            .flatMap((entry) => entry.images || [])
            .slice(-remaining)
            .filter((image) => {
              // A reused ID always points to the same immutable pixels. Keep all
              // historical text, but transmit that attachment only once.
              if (included.has(image.id)) return false;
              included.add(image.id);
              return true;
            })
        : [];
      if (previous.some((entry) => entry.images?.length))
        blocks.push({
          type: "text",
          text: "Only the recent historical images attached below are available visually. Older images may be omitted; ask the user to reattach one if needed.",
        });
      for (const image of selected) {
        try {
          const stored = await this.read(image.id);
          blocks.push({
            type: "text",
            text: `Historical image: ${image.name}`,
          });
          append(stored);
        } catch {
          blocks.push({
            type: "text",
            text: `Historical image unavailable: ${image.name}. Ask the user to reattach it if needed.`,
          });
        }
      }
      blocks.push({
        type: "text",
        text: `Current user request:\n${text || "请查看附图。"}`,
      });
    } else if (text) blocks.push({ type: "text", text });
    for (const image of images) append(image);
    if (!blocks.some((block) => block.type === "image"))
      return blocks
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("\n\n");
    return blocks;
  }
}
