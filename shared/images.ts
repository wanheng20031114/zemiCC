export const MAX_IMAGES = 5;
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

export type ImageAttachment = {
  id: string;
  name: string;
  mediaType: "image/png" | "image/jpeg";
  bytes: number;
  width: number;
  height: number;
};

export const imageUrl = (id: string) => `/api/images/${encodeURIComponent(id)}`;
