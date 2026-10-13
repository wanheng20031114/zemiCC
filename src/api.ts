let token = "";
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
