import { useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Check,
  Code2,
  Globe,
  KeyRound,
  Network,
  Pencil,
  Play,
  Plug,
  Plus,
  Power,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import type { McpTransport, McpView } from "../shared/mcp";
import { api } from "./api";
import { Modal } from "./Modal";

const states = {
  unchecked: "未测试",
  ready: "可用",
  failed: "连接失败",
  "needs-auth": "需要认证",
  "needs-secrets": "待填写凭据",
  disabled: "已停用",
};
type Pair = { name: string; value: string };
export function McpDialog({
  servers,
  busy,
  onClose,
  onChange,
}: {
  servers: McpView[];
  busy: boolean;
  onClose: () => void;
  onChange: () => Promise<void>;
}) {
  const [screen, setScreen] = useState<"list" | "form" | "import">("list");
  const [editing, setEditing] = useState<McpView>();
  const [name, setName] = useState("");
  const [type, setType] = useState<McpTransport>("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("[]");
  const [url, setUrl] = useState("");
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [json, setJson] = useState("");
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const locked = busy || !!pending;
  function edit(server?: McpView) {
    setEditing(server);
    setName(server?.name || "");
    setType(server?.type || "stdio");
    setCommand(server?.command || "");
    setArgs(JSON.stringify(server?.args || [], null, 2));
    setUrl(server?.url || "");
    setPairs(
      (server ? [...server.envKeys, ...server.headerKeys] : []).map((name) => ({
        name,
        value: "",
      })),
    );
    setError("");
    setScreen("form");
  }
  async function perform(
    id: string,
    action: () => Promise<unknown>,
    after?: () => void,
  ) {
    setPending(id);
    setError("");
    try {
      await action();
      await onChange();
      after?.();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setPending("");
    }
  }
  function back() {
    setPairs([]);
    setJson("");
    setError("");
    setScreen("list");
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    let parsedArgs: unknown;
    try {
      parsedArgs = type === "stdio" ? JSON.parse(args || "[]") : [];
    } catch {
      setError('参数需要是 JSON 字符串数组，例如 ["-y", "server-package"]');
      return;
    }
    const values: Record<string, string> = {};
    for (const pair of pairs) {
      if (!pair.name && !pair.value) continue;
      if (!pair.name || Object.hasOwn(values, pair.name)) {
        setError("凭据字段名称不能为空或重复");
        return;
      }
      values[pair.name] = pair.value;
    }
    const config =
      type === "stdio"
        ? { type, command, args: parsedArgs, env: values }
        : { type, url, headers: values };
    setPairs((rows) => rows.map((row) => ({ ...row, value: "" })));
    await perform(
      "save",
      () =>
        api("/mcp/import", {
          mcpServers: {
            [name]: { ...config, disabled: editing ? !editing.enabled : false },
          },
        }),
      back,
    );
  }
  async function importJson(event: FormEvent) {
    event.preventDefault();
    let value: unknown;
    try {
      value = JSON.parse(json);
    } catch {
      setError("JSON 格式不正确，请检查括号、引号和逗号");
      return;
    }
    setJson("");
    await perform("import", () => api("/mcp/import", value), back);
  }
  return (
    <Modal
      title="MCP 服务器"
      subtitle="把你的工具，接入同一个工作空间。"
      wide
      onClose={onClose}
    >
      <div className="mcp-panel">
        {busy && (
          <p className="mcp-note">任务正在执行，配置可在任务结束后修改。</p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {screen === "list" ? (
          <>
            <div className="mcp-toolbar">
              <span>{servers.length} 个服务器</span>
              <div>
                <button
                  className="secondary"
                  disabled={locked}
                  onClick={() => {
                    setError("");
                    setScreen("import");
                  }}
                >
                  <Code2 size={16} />
                  导入 JSON
                </button>
                <button
                  className="primary"
                  disabled={locked}
                  onClick={() => edit()}
                >
                  <Plus size={16} />
                  添加服务器
                </button>
              </div>
            </div>
            {!servers.length ? (
              <div className="mcp-empty">
                <div className="mcp-diagram" aria-hidden="true">
                  <Terminal size={24} />
                  <span />
                  <div>
                    <Network size={34} />
                  </div>
                  <span />
                  <Globe size={24} />
                </div>
                <h3>让 Claude 连接更多工具</h3>
                <p>本地命令 · HTTP · SSE</p>
              </div>
            ) : (
              <div className="mcp-list">
                {servers.map((server) => (
                  <article className="mcp-card" key={server.name}>
                    <div className="mcp-card-top">
                      <div className="mcp-server-icon">
                        {server.type === "stdio" ? (
                          <Terminal size={21} />
                        ) : (
                          <Globe size={21} />
                        )}
                      </div>
                      <div className="mcp-server-name">
                        <strong>{server.name}</strong>
                        <span>
                          {server.type === "stdio"
                            ? [server.command, ...(server.args || [])].join(" ")
                            : server.url}
                        </span>
                      </div>
                      <span className={`mcp-status ${server.status}`}>
                        <span />
                        {states[server.status]}
                      </span>
                    </div>
                    {server.error && (
                      <p className="mcp-error">{server.error}</p>
                    )}
                    {!!server.missing.length && (
                      <p className="mcp-note">
                        <KeyRound size={13} />
                        {server.missing.join(" · ")}
                      </p>
                    )}
                    <div className="mcp-card-bottom">
                      <span className="mcp-transport">
                        {server.type.toUpperCase()}
                      </span>
                      <span>{server.tools.length} 个工具</span>
                      <div className="mcp-actions">
                        <button
                          className="text-button"
                          disabled={
                            locked || !server.enabled || !!server.missing.length
                          }
                          onClick={() =>
                            void perform(`test:${server.name}`, () =>
                              api(
                                `/mcp/${encodeURIComponent(server.name)}/test`,
                                {},
                              ),
                            )
                          }
                        >
                          {pending === `test:${server.name}` ? (
                            <span className="spinner" />
                          ) : (
                            <Play size={14} />
                          )}
                          测试连接
                        </button>
                        <button
                          className="icon-button"
                          title="编辑服务器"
                          aria-label={`编辑 ${server.name}`}
                          disabled={locked}
                          onClick={() => edit(server)}
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          className={`icon-button ${server.enabled ? "active" : ""}`}
                          title={server.enabled ? "停用服务器" : "启用服务器"}
                          aria-label={`${server.enabled ? "停用" : "启用"} ${server.name}`}
                          disabled={locked}
                          onClick={() =>
                            void perform(`toggle:${server.name}`, () =>
                              api(
                                `/mcp/${encodeURIComponent(server.name)}/enabled`,
                                { enabled: !server.enabled },
                              ),
                            )
                          }
                        >
                          <Power size={16} />
                        </button>
                        <button
                          className="icon-button"
                          title="移除服务器"
                          aria-label={`移除 ${server.name}`}
                          disabled={locked}
                          onClick={() =>
                            void perform(`remove:${server.name}`, () =>
                              api(
                                `/mcp/${encodeURIComponent(server.name)}`,
                                undefined,
                                "DELETE",
                              ),
                            )
                          }
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                    {!!server.tools.length && (
                      <details className="mcp-tools">
                        <summary>查看工具</summary>
                        <div>
                          {server.tools.map((tool) => (
                            <div key={tool.name}>
                              <Code2 size={14} />
                              <span>
                                <strong>{tool.name}</strong>
                                {tool.description && (
                                  <small>{tool.description}</small>
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </article>
                ))}
              </div>
            )}
            <p className="mcp-footnote">
              <Plug size={14} />
              保存后在下一条消息中接入。测试连接只检查服务和工具。
            </p>
          </>
        ) : (
          <>
            <button
              type="button"
              className="text-button mcp-back"
              onClick={back}
              disabled={!!pending}
            >
              <ArrowLeft size={15} />
              服务器列表
            </button>
            {screen === "import" ? (
              <form onSubmit={importJson} autoComplete="off">
                <label className="field-label" htmlFor="mcp-json">
                  mcpServers JSON
                </label>
                <textarea
                  id="mcp-json"
                  className="text-input mcp-json"
                  value={json}
                  onChange={(event) => setJson(event.target.value)}
                  required
                  spellCheck={false}
                  placeholder={
                    '{\n  "mcpServers": {\n    "my-server": {\n      "command": "npx",\n      "args": ["-y", "server-package"]\n    }\n  }\n}'
                  }
                />
                <p className="mcp-note">
                  同名服务器会更新。env 和 headers 的值仅保留在内存中。
                </p>
                <div className="mcp-form-footer">
                  <button className="primary" disabled={locked}>
                    <Check size={16} />
                    {pending ? "正在导入…" : "导入配置"}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={save} autoComplete="off">
                <div
                  className="mcp-transports"
                  role="tablist"
                  aria-label="传输方式"
                >
                  {(
                    [
                      ["stdio", "本地命令", <Terminal size={17} />],
                      ["http", "HTTP", <Globe size={17} />],
                      ["sse", "SSE", <Network size={17} />],
                    ] as const
                  ).map(([value, label, icon]) => (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={type === value}
                      key={value}
                      className={type === value ? "selected" : ""}
                      disabled={locked}
                      onClick={() => {
                        if (type === value) return;
                        setType(value);
                        setPairs([]);
                      }}
                    >
                      {icon}
                      {label}
                    </button>
                  ))}
                </div>
                <label className="field-label" htmlFor="mcp-name">
                  名称
                </label>
                <input
                  id="mcp-name"
                  className="text-input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="my-server"
                  required
                  disabled={!!editing || locked}
                  maxLength={64}
                  spellCheck={false}
                />
                {type === "stdio" ? (
                  <>
                    <label className="field-label" htmlFor="mcp-command">
                      启动命令
                    </label>
                    <input
                      id="mcp-command"
                      className="text-input"
                      value={command}
                      onChange={(event) => setCommand(event.target.value)}
                      placeholder="npx / uvx / 可执行文件路径"
                      required
                      spellCheck={false}
                    />
                    <label className="field-label" htmlFor="mcp-args">
                      参数 · JSON 数组
                    </label>
                    <textarea
                      id="mcp-args"
                      className="text-input mcp-args"
                      value={args}
                      onChange={(event) => setArgs(event.target.value)}
                      spellCheck={false}
                    />
                  </>
                ) : (
                  <>
                    <label className="field-label" htmlFor="mcp-url">
                      服务器地址
                    </label>
                    <input
                      id="mcp-url"
                      className="text-input"
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                      placeholder="https://mcp.example.com/mcp"
                      required
                      type="url"
                      spellCheck={false}
                    />
                  </>
                )}
                <div className="mcp-secrets-heading">
                  <label className="field-label">
                    {type === "stdio" ? "环境变量" : "认证请求头"}
                    <small>
                      <KeyRound size={12} />
                      仅本次运行
                    </small>
                  </label>
                  <button
                    type="button"
                    className="text-button"
                    disabled={locked}
                    onClick={() =>
                      setPairs((rows) => [...rows, { name: "", value: "" }])
                    }
                  >
                    <Plus size={14} />
                    添加
                  </button>
                </div>
                {pairs.map((pair, index) => (
                  <div className="mcp-pair" key={index}>
                    <input
                      className="text-input"
                      aria-label={`凭据名称 ${index + 1}`}
                      value={pair.name}
                      placeholder={
                        type === "stdio" ? "SERVER_TOKEN" : "Authorization"
                      }
                      spellCheck={false}
                      onChange={(event) =>
                        setPairs((rows) =>
                          rows.map((row, i) =>
                            i === index
                              ? { ...row, name: event.target.value }
                              : row,
                          ),
                        )
                      }
                    />
                    <input
                      className="text-input"
                      aria-label={`凭据值 ${index + 1}`}
                      type="password"
                      value={pair.value}
                      autoComplete="new-password"
                      placeholder={
                        editing &&
                        [...editing.envKeys, ...editing.headerKeys].includes(
                          pair.name,
                        ) &&
                        !editing.missing.some((field) =>
                          field.endsWith(`.${pair.name}`),
                        )
                          ? "已载入，留空保留"
                          : type === "stdio"
                            ? "值"
                            : "Bearer …"
                      }
                      onChange={(event) =>
                        setPairs((rows) =>
                          rows.map((row, i) =>
                            i === index
                              ? { ...row, value: event.target.value }
                              : row,
                          ),
                        )
                      }
                    />
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`移除凭据 ${index + 1}`}
                      onClick={() =>
                        setPairs((rows) => rows.filter((_, i) => i !== index))
                      }
                    >
                      <X size={15} />
                    </button>
                  </div>
                ))}
                <p className="mcp-note">
                  密钥放在上述字段中，勿写入启动参数或地址。
                </p>
                <div className="mcp-form-footer">
                  <span>
                    {type === "stdio"
                      ? "测试或使用时会运行此命令"
                      : "调用数据会发送至此服务器"}
                  </span>
                  <button className="primary" disabled={locked}>
                    <Check size={16} />
                    {pending ? "正在保存…" : "保存"}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
