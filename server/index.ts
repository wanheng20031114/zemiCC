import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { AgentHost } from "./agent.js";
import { createAccessGuard } from "./security.js";
import {
  projectRoot,
  listFiles,
  readFile,
  gitChanges,
  fileDiff,
} from "./projects.js";

export async function startServer(
  options: {
    port?: number;
    root?: string;
    dataDir?: string;
    claudeExecutablePath?: string;
    pickDirectory?: () => Promise<string | undefined>;
  } = {},
) {
  const root = options.root || process.cwd();
  const host = new AgentHost(
    options.dataDir ||
      process.env.ZEMICC_DATA_DIR ||
      path.join(root, ".zemicc"),
    options.claudeExecutablePath,
  );
  await host.init();
  const app = express();
  let port = options.port ?? Number(process.env.ZEMICC_PORT || 4317);
  const access = createAccessGuard(() => port);
  app.disable("x-powered-by");
  app.use(access.networkGuard);
  app.use(express.json({ limit: "128kb" }));
  app.get("/api/bootstrap", access.bootstrap);
  app.use("/api", access.apiGuard);
  app.get("/api/state", (_req, res) =>
    res.json(host.vault.clean(host.snapshot())),
  );
  app.post("/api/permissions", async (req, res) => {
    if (req.body.mode !== "auto" && req.body.mode !== "manual")
      throw new Error("权限模式无效");
    if (
      req.body.sessionId !== undefined &&
      typeof req.body.sessionId !== "string"
    )
      throw new Error("会话无效");
    await host.setPermissions(req.body.mode, req.body.sessionId);
    res.json(host.vault.clean(host.snapshot()));
  });
  app.get("/api/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    const listener = (data: unknown) =>
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    host.listeners.add(listener);
    listener({ type: "state", state: host.snapshot() });
    const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 20_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      host.listeners.delete(listener);
    });
  });
  app.post("/api/credential", async (req, res) => {
    const key = req.body?.key;
    if (typeof key !== "string") throw new Error("需要 API key");
    // Validate format before closing an existing connection. No network call and no logging.
    if (key.length < 12 || key.length > 512 || /\s/.test(key))
      throw new Error("请输入有效的 API key");
    await host.credential(key);
    req.body.key = undefined;
    res.json({ connected: true });
  });
  app.delete("/api/credential", async (_req, res) => {
    await host.credential();
    res.json({ connected: false });
  });
  app.post("/api/project", async (req, res) => {
    const project = await projectRoot(String(req.body.path || ""));
    await host.setProject(project);
    res.json({ project });
  });
  app.post("/api/project/pick", async (_req, res) => {
    if (!options.pickDirectory) {
      res.status(409).json({ error: "浏览器模式请粘贴文件夹路径" });
      return;
    }
    const selected = await options.pickDirectory();
    if (selected) await host.setProject(await projectRoot(selected));
    res.json({ project: host.project });
  });
  const model = (value: unknown) => {
    if (
      typeof value !== "string" ||
      !/^claude-[a-zA-Z0-9._-]{3,80}$/.test(value)
    )
      throw new Error("模型名称无效");
    return value;
  };
  app.post("/api/sessions", async (req, res) => {
    const s = await host.create(
      await projectRoot(host.project),
      model(req.body.model),
    );
    res.json(s);
  });
  app.delete("/api/sessions/:id", async (req, res) => {
    await host.remove(req.params.id);
    res.json({ ok: true });
  });
  app.post("/api/sessions/:id/send", async (req, res) => {
    if (typeof req.body.text !== "string") throw new Error("消息无效");
    await host.send(req.params.id, req.body.text, model(req.body.model));
    res.json({ ok: true });
  });
  app.post("/api/sessions/:id/stop", async (req, res) => {
    await host.stop(req.params.id);
    res.json({ ok: true });
  });
  app.post("/api/sessions/:id/approvals/:approvalId", async (req, res) => {
    const answers = req.body.answers;
    if (
      answers &&
      (typeof answers !== "object" ||
        Object.values(answers).some((v) => typeof v !== "string"))
    )
      throw new Error("回答无效");
    await host.decide(req.params.id, req.params.approvalId, {
      allow: req.body.allow === true,
      answers,
    });
    res.json({ ok: true });
  });
  function project(req: express.Request) {
    const id =
      typeof req.query.session === "string" ? req.query.session : undefined;
    const p = id ? host.get(id).project : host.project;
    if (!p) throw new Error("请先选择项目");
    return p;
  }
  app.get("/api/files", async (req, res) =>
    res.json(
      await listFiles(
        project(req),
        typeof req.query.path === "string" ? req.query.path : ".",
      ),
    ),
  );
  app.get("/api/file", async (req, res) =>
    res.json({
      content: host.vault.redact(
        await readFile(project(req), String(req.query.path || "")),
      ),
    }),
  );
  app.get("/api/changes", async (req, res) =>
    res.json(await gitChanges(project(req))),
  );
  app.get("/api/diff", async (req, res) =>
    res.json({
      content: host.vault.redact(
        await fileDiff(project(req), String(req.query.path || "")),
      ),
    }),
  );
  app.use(express.static(path.join(root, "dist"), { etag: false }));
  app.get("/{*splat}", (req, res) => {
    if (req.path.startsWith("/api/"))
      res.status(404).json({ error: "接口不存在" });
    else res.sendFile(path.join(root, "dist/index.html"));
  });
  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res
        .status(400)
        .json({ error: host.vault.redact(err.message || "操作失败") });
    },
  );
  const server: Server = await new Promise((resolve, reject) => {
    const srv = app.listen(port, "127.0.0.1", () => resolve(srv));
    srv.on("error", reject);
  });
  port = (server.address() as { port: number }).port;
  let closing = false;
  return {
    host,
    port,
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      if (closing) return;
      closing = true;
      await host.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const server = await startServer();
  console.log(`zemiCC · ${server.url}`);
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      void server.close().then(() => process.exit(0));
    });
}
