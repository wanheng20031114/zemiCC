let token = "";
import type { ImageAttachment } from "../shared/images";

export async function uploadImage(file: File): Promise<ImageAttachment> {
  const response = await fetch("/api/images", {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-zemicc-token": token,
      "x-zemicc-filename": encodeURIComponent(file.name || "粘贴的图片"),
    },
    body: file,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "图片添加失败");
  return data;
}
export async function bootstrap() {
  const response = await fetch("/api/bootstrap", {
    headers: { "x-zemicc-client": "1" },
  });
  if (!response.ok) throw new Error("无法连接本地服务");
  token = (await response.json()).token;
}
export async function api<T>(
  url: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const response = await fetch(`/api${url}`, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: { "content-type": "application/json", "x-zemicc-token": token },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "操作失败");
  return data;
}
