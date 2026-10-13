import fs from "node:fs/promises";
import path from "node:path";
import {
  query,
  type McpServerConfig,
  type McpServerStatus,
  type Query,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { McpDefinition, McpView } from "../shared/mcp.js";
import { CredentialVault, sdkEnvironment } from "./security.js";

type Secrets = { env: Record<string, string>; headers: Record<string, string> };
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("MCP 配置需要是 JSON 对象");
  return value as Record<string, unknown>;
};
function text(value: unknown, label: string, max = 4096) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\0\r\n]/.test(value)
  )
    throw new Error(`${label}无效`);
  return value;
}
function fields(value: unknown, label: string) {
  if (value === undefined) return {};
  const entries = Object.entries(object(value));
  if (entries.length > 64) throw new Error(`${label}过多`);
  for (const [key, item] of entries) {
    if (
      !/^[A-Za-z_][A-Za-z0-9_-]{0,127}$/.test(key) ||
      typeof item !== "string" ||
      item.length > 8192 ||
      /[\0\r\n]/.test(item)
    )
      throw new Error(`${label}格式无效`);
  }
  return Object.fromEntries(entries) as Record<string, string>;
}
function publicText(value: string, vault: CredentialVault) {
  if (
    vault.redact(value) !== value ||
    /(?:--?|\/)(?:api[-_]?key|token|password|secret|authorization)(?:[= :]|$)/i.test(
      value,
    )
  )
    throw new Error(
      "密钥请放入环境变量或认证请求头，不要写进名称、命令、参数或地址",
    );
}

/** Persist only connection definitions and secret field names, never their values. */
export class McpRegistry {
  #definitions = new Map<string, McpDefinition>();
  #secrets = new Map<string, Secrets>();
  #status = new Map<string, Pick<McpView, "status" | "tools" | "error">>();
  #probes = new Set<AbortController>();
  #probeJobs = new Set<Promise<void>>();
  revision = 0;
  constructor(
    readonly dataDir: string,
    readonly vault: CredentialVault,
    readonly executable?: string,
  ) {}
  get file() {
    return path.join(this.dataDir, "mcp-servers.json");
  }
  async init() {
    try {
      const saved = JSON.parse(await fs.readFile(this.file, "utf8"));
      if (saved.version !== 1 || !Array.isArray(saved.servers))
        throw new Error("Invalid MCP file");
      for (const definition of saved.servers as McpDefinition[]) {
        const parsed = this.parse(definition.name, {
          type: definition.type,
          command: definition.command,
          args: definition.args,
          url: definition.url,
          disabled: !definition.enabled,
          env: Object.fromEntries(definition.envKeys.map((key) => [key, ""])),
          headers: Object.fromEntries(
            definition.headerKeys.map((key) => [key, ""]),
          ),
        });
        this.#definitions.set(parsed.definition.name, parsed.definition);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("本地 MCP 配置无法读取；原文件已保留");
    }
  }
  private parse(name: string, value: unknown) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name) || name.includes("__"))
      throw new Error(
        "服务器名称需以字母开头，只使用字母、数字、单个下划线或短横线",
      );
    const config = object(value);
    const allowed = new Set([
      "type",
      "command",
      "args",
      "env",
      "url",
      "headers",
      "disabled",
    ]);
    if (Object.keys(config).some((key) => !allowed.has(key)))
      throw new Error(
        "配置包含不支持的字段；支持 type、command、args、env、url、headers、disabled",
      );
    const type = config.type ?? (config.command ? "stdio" : "http");
    if (type !== "stdio" && type !== "http" && type !== "sse")
      throw new Error("支持 stdio、HTTP 和 SSE 服务器");
    if (config.disabled !== undefined && typeof config.disabled !== "boolean")
      throw new Error("disabled 需要是布尔值");
    const env = fields(config.env, "环境变量"),
      headers = fields(config.headers, "请求头");
    if (
      (type === "stdio" && Object.keys(headers).length) ||
      (type !== "stdio" && Object.keys(env).length)
    )
      throw new Error("本地服务器使用环境变量，远程服务器使用请求头");
    const old = this.#secrets.get(name);
    const secrets: Secrets = {
      env: Object.fromEntries(
        Object.entries(env).map(([key, value]) => [
          key,
          value || old?.env[key] || "",
        ]),
      ),
      headers: Object.fromEntries(
        Object.entries(headers).map(([key, value]) => [
          key,
          value || old?.headers[key] || "",
        ]),
      ),
    };
    this.vault.protect([
      ...Object.values(secrets.env),
      ...Object.values(secrets.headers),
    ]);
    const definition: McpDefinition = {
      name,
      type,
      enabled: config.disabled !== true,
      envKeys: Object.keys(env),
      headerKeys: Object.keys(headers),
    };
    publicText(name, this.vault);
    if (type === "stdio") {
      definition.command = text(config.command, "启动命令", 2048).trim();
      if (config.url !== undefined) throw new Error("本地服务器不使用 URL");
      if (
        config.args !== undefined &&
        (!Array.isArray(config.args) ||
          config.args.length > 128 ||
          config.args.some(
            (arg) =>
              typeof arg !== "string" ||
              arg.length > 4096 ||
              /[\0\r\n]/.test(arg),
          ))
      )
        throw new Error("参数需要是字符串数组");
      definition.args = (config.args || []) as string[];
      publicText(definition.command, this.vault);
      for (const arg of definition.args) publicText(arg, this.vault);
    } else {
      if (config.command !== undefined || config.args !== undefined)
        throw new Error("远程服务器不使用启动命令");
      const raw = text(config.url, "服务器地址");
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        throw new Error("服务器地址无效");
      }
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.hash ||
        /(?:key|token|secret|password|auth)/i.test(
          [...url.searchParams.keys()].join(" "),
        )
      )
        throw new Error("请使用 HTTP(S) 地址，认证信息放入请求头");
      if (
        url.protocol === "http:" &&
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      )
        throw new Error("远程服务器请使用 HTTPS，本机服务可以使用 HTTP");
      publicText(raw, this.vault);
      definition.url = raw;
    }
    return { definition, secrets };
  }
  private async persist(definitions: Map<string, McpDefinition>) {
    await fs.mkdir(this.dataDir, { recursive: true });
    const tmp = this.file + ".tmp";
    await fs.writeFile(
      tmp,
      JSON.stringify({ version: 1, servers: [...definitions.values()] }),
      { mode: 0o600 },
    );
    await fs.rename(tmp, this.file);
  }
  async import(value: unknown) {
    const root = object(value);
    if (Object.keys(root).length !== 1 || !root.mcpServers)
      throw new Error("请提供包含 mcpServers 对象的标准 JSON");
    const entries = Object.entries(object(root.mcpServers));
    if (!entries.length || entries.length > 32)
      throw new Error("一次可导入 1–32 个服务器");
    const parsed = entries.map(([name, config]) => this.parse(name, config));
    const next = new Map(this.#definitions);
    for (const item of parsed) next.set(item.definition.name, item.definition);
    if (next.size > 64) throw new Error("服务器数量过多");
    await this.persist(next);
    this.#definitions = next;
    for (const item of parsed) {
      this.#secrets.set(item.definition.name, item.secrets);
      this.#status.delete(item.definition.name);
    }
    this.revision++;
  }
  async enable(name: string, enabled: boolean) {
    const previous = this.#definitions.get(name);
    if (!previous) throw new Error("MCP 服务器不存在");
    const next = new Map(this.#definitions);
    next.set(name, { ...previous, enabled });
    await this.persist(next);
    this.#definitions = next;
    this.revision++;
  }
  async remove(name: string) {
    if (!this.#definitions.has(name)) throw new Error("MCP 服务器不存在");
    const next = new Map(this.#definitions);
    next.delete(name);
    await this.persist(next);
    this.#definitions = next;
    this.#secrets.delete(name);
    this.#status.delete(name);
    this.revision++;
  }
  missing(definition: McpDefinition) {
    const secrets = this.#secrets.get(definition.name);
    return [
      ...definition.envKeys
        .filter((key) => !secrets?.env[key])
        .map((key) => `env.${key}`),
      ...definition.headerKeys
        .filter((key) => !secrets?.headers[key])
        .map((key) => `headers.${key}`),
    ];
  }
  names() {
    return [...this.#definitions.values()]
      .filter((item) => item.enabled && !this.missing(item).length)
      .map((item) => item.name);
  }
  views(): McpView[] {
    return [...this.#definitions.values()].map((definition) => {
      const missing = this.missing(definition);
      const status = this.#status.get(definition.name) || {
        status: "unchecked" as const,
        tools: [],
      };
      return this.vault.clean({
        ...definition,
        ...status,
        status: !definition.enabled
          ? "disabled"
          : missing.length
            ? "needs-secrets"
            : status.status,
        missing,
      });
    });
  }
  configs(only?: string): Record<string, McpServerConfig> {
    return Object.fromEntries(
      [...this.#definitions.values()]
        .filter(
          (item) =>
            item.enabled &&
            !this.missing(item).length &&
            (!only || only === item.name),
        )
        .map((item) => {
          const secrets = this.#secrets.get(item.name);
          const config: McpServerConfig =
            item.type === "stdio"
              ? {
                  type: "stdio",
                  command: item.command!,
                  args: item.args,
                  env: { ANTHROPIC_API_KEY: "", ...secrets?.env },
                }
              : { type: item.type, url: item.url!, headers: secrets?.headers };
          return [item.name, config];
        }),
    );
  }
  record(statuses: McpServerStatus[], errors: Record<string, string> = {}) {
    for (const item of statuses) {
      if (!this.#definitions.has(item.name)) continue;
      this.#status.set(
        item.name,
        this.vault.clean({
          status:
            item.status === "connected"
              ? "ready"
              : item.status === "needs-auth"
                ? "needs-auth"
                : item.status === "disabled"
                  ? "disabled"
                  : item.status === "pending"
                    ? "unchecked"
                    : "failed",
          tools: (item.tools || []).slice(0, 500).map((tool) => ({
            name: tool.name.slice(0, 256),
            description: tool.description?.slice(0, 600),
          })),
          error: item.error?.slice(0, 1500),
        }),
      );
    }
    for (const [name, error] of Object.entries(errors)) {
      if (this.#definitions.has(name))
        this.#status.set(name, {
          status: "failed",
          tools: [],
          error: this.vault.redact(error).slice(0, 1500),
        });
    }
  }
  async attach(worker: Query) {
    const revision = this.revision;
    const result = await worker.setMcpServers(this.configs());
    const statuses = await worker.mcpServerStatus();
    if (revision !== this.revision) return [];
    this.record(statuses, result.errors);
    return this.views().filter(
      (item) => item.enabled && item.status !== "ready",
    );
  }
  async probe(name: string) {
    const job = this.runProbe(name);
    this.#probeJobs.add(job);
    try {
      await job;
    } finally {
      this.#probeJobs.delete(job);
    }
  }
  private async runProbe(name: string) {
    const config = this.configs(name);
    if (!config[name]) throw new Error("请启用服务器并补齐本次凭据");
    const runtime = await fs.mkdtemp(path.join(this.dataDir, "mcp-check-"));
    const abort = new AbortController();
    this.#probes.add(abort);
    let finish: (() => void) | undefined;
    const prompt = (async function* (): AsyncGenerator<SDKUserMessage> {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    })();
    let worker: Query | undefined;
    const timer = setTimeout(() => {
      abort.abort();
      worker?.close();
      finish?.();
    }, 30_000);
    try {
      worker = query({
        prompt,
        options: {
          cwd: runtime,
          env: sdkEnvironment("", runtime),
          settingSources: [],
          strictMcpConfig: true,
          persistSession: false,
          permissionMode: "default",
          tools: [],
          abortController: abort,
          pathToClaudeCodeExecutable: this.executable,
          stderr: () => {},
        },
      });
      const result = await worker.setMcpServers(config);
      this.record(await worker.mcpServerStatus(), result.errors);
    } catch {
      this.#status.set(name, {
        status: "failed",
        tools: [],
        error: abort.signal.aborted
          ? "连接测试已超时或取消"
          : "连接失败，请检查命令、运行环境或服务器地址",
      });
    } finally {
      clearTimeout(timer);
      abort.abort();
      worker?.close();
      finish?.();
      await worker?.return().catch(() => {});
      this.#probes.delete(abort);
      await fs.rm(runtime, { recursive: true, force: true, maxRetries: 3 });
    }
  }
  async close() {
    for (const abort of this.#probes) abort.abort();
    await Promise.allSettled(this.#probeJobs);
    this.#secrets.clear();
    this.#status.clear();
  }
}
