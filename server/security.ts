import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Request, Response, NextFunction } from "express";

/** Deliberately has no serialization method. A key exists for this process only. */
export class CredentialVault {
  #key = "";
  set(key: string) {
    if (
      typeof key !== "string" ||
      key.length < 12 ||
      key.length > 512 ||
      /\s/.test(key)
    )
      throw new Error("请输入有效的 API key");
    this.#key = key;
  }
  get() {
    if (!this.#key) throw new Error("请先连接 API key");
    return this.#key;
  }
  clear() {
    this.#key = "";
  }
  get connected() {
    return this.#key.length > 0;
  }
  redact(text: string) {
    const exact = this.#key ? text.split(this.#key).join("[REDACTED]") : text;
    return exact
      .replace(/\bsk-(?:ant-)?[a-zA-Z0-9_-]{10,}/g, "[REDACTED]")
      .replace(
        /((?:api[_-]?key|authorization|auth[_-]?token)\s*[=:]\s*)[^\s,;"}]+/gi,
        "$1[REDACTED]",
      );
  }
  clean<T>(value: T): T {
    return JSON.parse(this.redact(JSON.stringify(value))) as T;
  }
}

export function privatePath(candidate: string) {
  return candidate
    .split(/[\\/]/)
    .some(
      (p) =>
        /^(?:\.env(?:\..*)?|\.git|\.zemicc|\.claude|\.ssh|\.aws|\.azure|\.npmrc|\.netrc|credentials(?:\..*)?|id_rsa|id_ed25519)$/i.test(
          p.replace(/[. ]+$/, "").split(":")[0],
        ) || /\.(?:pem|key|p12|pfx)$/i.test(p.split(":")[0]),
    );
}
export function contained(root: string, target: string) {
  const rel = path.relative(root, target);
  return (
    rel === "" ||
    (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel))
  );
}
export async function safePath(
  root: string,
  requested = ".",
  allowMissing = false,
) {
  if (requested.includes("\0")) throw new Error("无效路径");
  const realRoot = await fs.realpath(root);
  const resolved = path.resolve(realRoot, requested);
  if (path.relative(realRoot, resolved).includes(":"))
    throw new Error("不允许访问备用数据流");
  if (privatePath(path.relative(realRoot, resolved)))
    throw new Error("此路径不在可访问的项目范围内");
  // Canonicalize before comparing: Windows may give us an 8.3 alias for the
  // same directory. For new files, resolve the nearest existing ancestor so
  // junctions and symlinks cannot bypass the project boundary.
  let existing = resolved;
  while (true) {
    try {
      const real = await fs.realpath(existing);
      const canonical = path.resolve(real, path.relative(existing, resolved));
      if (
        !contained(realRoot, canonical) ||
        privatePath(path.relative(realRoot, canonical))
      )
        throw new Error("不允许访问项目外的链接或敏感目录");
      return canonical;
    } catch (e) {
      if (
        !allowMissing ||
        (e as NodeJS.ErrnoException).code !== "ENOENT" ||
        path.dirname(existing) === existing
      )
        throw e;
      existing = path.dirname(existing);
    }
  }
}

export function createAccessGuard(port: () => number) {
  const token = randomBytes(32).toString("base64url");
  const origin = () => `http://127.0.0.1:${port()}`;
  const same = (a: string) => {
    const x = Buffer.from(a);
    const y = Buffer.from(token);
    return x.length === y.length && timingSafeEqual(x, y);
  };
  function networkGuard(req: Request, res: Response, next: NextFunction) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    if (
      req.headers.host !== `127.0.0.1:${port()}` ||
      (req.headers.origin && req.headers.origin !== origin()) ||
      req.headers["sec-fetch-site"] === "cross-site"
    ) {
      res.status(403).json({ error: "仅允许从本机 zemiCC 窗口访问" });
      return;
    }
    next();
  }
  function apiGuard(req: Request, res: Response, next: NextFunction) {
    const cookies = Object.fromEntries(
      (req.headers.cookie || "").split(";").map((c) => c.trim().split("=")),
    );
    const provided = req.headers["x-zemicc-token"];
    // SSE cannot set a custom header. Its HttpOnly SameSite cookie is issued only by /api/bootstrap.
    const valid =
      req.method === "GET"
        ? same(cookies.zemicc || "")
        : typeof provided === "string" && same(provided);
    if (!valid) {
      res.status(401).json({ error: "请重新打开 zemiCC 窗口" });
      return;
    }
    next();
  }
  function bootstrap(req: Request, res: Response) {
    if (req.headers["x-zemicc-client"] !== "1") {
      res.status(403).json({ error: "需要本机客户端" });
      return;
    }
    res.cookie("zemicc", token, {
      httpOnly: true,
      sameSite: "strict",
      path: "/api",
    });
    res.json({ token });
  }
  return { networkGuard, apiGuard, bootstrap };
}

export function sdkEnvironment(key: string, configDir: string) {
  const env: Record<string, string | undefined> = {};
  // An allowlist avoids leaking unrelated local credentials into the agent process.
  for (const name of [
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "SYSTEMROOT",
    "COMSPEC",
    "TEMP",
    "TMP",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "LANG",
    "SHELL",
    "ProgramFiles",
    "ProgramFiles(x86)",
  ]) {
    if (process.env[name]) env[name] = process.env[name];
  }
  Object.assign(env, {
    ANTHROPIC_API_KEY: key,
    ANTHROPIC_BASE_URL: "https://api.anthropic.com",
    CLAUDE_CONFIG_DIR: configDir,
    CLAUDE_AGENT_SDK_CLIENT_APP: "zemicc/0.1.0",
    DISABLE_TELEMETRY: "1",
    DISABLE_ERROR_REPORTING: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: "1",
    CLAUDE_CODE_USE_POWERSHELL_TOOL: "1",
  });
  // The SDK replaces the subprocess environment with this allowlisted object.
  return env;
}
