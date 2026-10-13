import { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import {
  MAX_IMAGES,
  MAX_UPLOAD_BYTES,
  imageUrl,
  type ImageAttachment,
} from "../shared/images";
import { uploadImage } from "./api";

type DraftImage = { id: string; name: string; image?: ImageAttachment };

/** Drafts belong to their conversation, including uploads that finish after switching. */
export function useImageDraft(key: string, onError: (message: string) => void) {
  const [drafts, setDrafts] = useState<Record<string, DraftImage[]>>({});
  const current = useRef(drafts);
  function update(
    target: string,
    change: (images: DraftImage[]) => DraftImage[],
  ) {
    current.current = {
      ...current.current,
      [target]: change(current.current[target] || []),
    };
    setDrafts(current.current);
  }
  function addFiles(files: File[]) {
    const remaining = MAX_IMAGES - (current.current[key]?.length || 0);
    if (files.length > remaining)
      onError(`每条消息最多添加 ${MAX_IMAGES} 张图片`);
    for (const file of files.slice(0, remaining)) {
      if (
        !/^image\/(png|jpeg|webp|gif)$/.test(file.type) &&
        !/\.(png|jpe?g|webp|gif)$/i.test(file.name)
      ) {
        onError("请选择 PNG、JPEG、WebP 或 GIF 图片");
        continue;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        onError("每张图片不能超过 20 MB");
        continue;
      }
      const id = crypto.randomUUID();
      update(key, (images) => [
        ...images,
        { id, name: file.name || "粘贴的图片" },
      ]);
      void uploadImage(file)
        .then((image) => {
          update(key, (images) =>
            images.map((item) => (item.id === id ? { ...item, image } : item)),
          );
        })
        .catch((error: Error) => {
          update(key, (images) => images.filter((item) => item.id !== id));
          onError(error.message);
        });
    }
  }
  const items = drafts[key] || [];
  return {
    items,
    uploading: items.some((item) => !item.image),
    images: items.flatMap((item) => (item.image ? [item.image] : [])),
    addFiles,
    remove: (id: string) =>
      update(key, (items) => items.filter((item) => item.id !== id)),
    clear: () => update(key, () => []),
    restore: (images: ImageAttachment[], target = key) =>
      update(target, (items) => {
        const ids = new Set(
          items.flatMap((item) => (item.image ? [item.image.id] : [])),
        );
        return [
          ...items,
          ...images
            .filter((image) => !ids.has(image.id))
            .map((image) => ({
              id: crypto.randomUUID(),
              name: image.name,
              image,
            })),
        ];
      }),
  };
}

export function ImageTiles({
  images,
  onOpen,
}: {
  images: ImageAttachment[];
  onOpen: (image: ImageAttachment) => void;
}) {
  return (
    <div className="image-tiles">
      {images.map((image) => (
        <button
          type="button"
          className="image-tile"
          key={image.id}
          onClick={() => onOpen(image)}
          title={image.name}
          aria-label={`查看图片 ${image.name}`}
        >
          <img src={imageUrl(image.id)} alt={image.name} loading="lazy" />
          <span>{image.name}</span>
        </button>
      ))}
    </div>
  );
}

export function DraftImages({
  items,
  onRemove,
  onOpen,
}: {
  items: DraftImage[];
  onRemove: (id: string) => void;
  onOpen: (image: ImageAttachment) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="draft-images" aria-label="待发送图片">
      {items.map((item) => (
        <div className="draft-image" key={item.id}>
          <button
            type="button"
            className="draft-image-preview"
            onClick={() => item.image && onOpen(item.image)}
            disabled={!item.image}
            aria-label={`预览图片 ${item.name}`}
          >
            {item.image ? (
              <img src={imageUrl(item.image.id)} alt={item.name} />
            ) : (
              <span className="image-loading">
                <ImagePlus size={20} />
                <span className="spinner" />
              </span>
            )}
            <span title={item.name}>{item.name}</span>
          </button>
          <button
            type="button"
            className="image-remove"
            title="移除图片"
            aria-label={`移除图片 ${item.name}`}
            onClick={() => onRemove(item.id)}
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
