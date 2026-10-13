import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  ArrowUp,
  ArrowUpRight,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Code2,
  CornerDownLeft,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  GitCompareArrows,
  KeyRound,
  Layers2,
  LockKeyhole,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  Unplug,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  Approval,
  Change,
  Entry,
  FileItem,
  PermissionMode,
  Session,
  Snapshot,
} from "../shared/types";
import { MODELS } from "../shared/types";
import { api, bootstrap } from "./api";
import { useZoom } from "./useZoom";

const basename = (p: string) =>
  p.split(/[\\/]/).filter(Boolean).at(-1) || "选择项目";
const compact = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
const phaseText = {
  idle: "已完成",
  running: "正在工作",
  approval: "等待确认",
  error: "需要处理",
  interrupted: "已停止",
};
function Mark({ size = 32 }: { size?: number }) {
  return (
    <img
      className="app-mark"
      src="/mark.svg"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
    />
  );
}
function IconButton({
  label,
  children,
  onClick,
  active = false,
  className = "",
  disabled = false,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? "active" : ""} ${className}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === dialog.current) onClose();
      }}
      aria-label={title}
    >
      <div className="modal-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <IconButton label="关闭" onClick={onClose}>
          <X size={19} />
        </IconButton>
      </div>
      {children}
    </dialog>
  );
}
function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        ),
        img: ({ alt }) => (
          <span className="image-placeholder">{alt || "外部图片"}</span>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

function Connection({
  connected,
  onClose,
  onChange,
}: {
  connected: boolean;
  onClose: () => void;
  onChange: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function connect(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    let key = input.current?.value.trim() || "";
    if (input.current) input.current.value = "";
    try {
      await api("/credential", { key });
      key = "";
      onChange();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      key = "";
      setBusy(false);
    }
  }
  return (
    <Modal
      title="连接你的 Claude"
      subtitle="密钥随窗口进程结束而清除。"
      onClose={onClose}
    >
      <div className="connection-art">
        <div className="connection-node">
          <Mark size={34} />
        </div>
        <span className="connection-line" />
        <LockKeyhole size={21} />
        <span className="connection-line" />
        <div className="connection-node api-node">A</div>
      </div>
      <form onSubmit={connect} autoComplete="off">
        <label className="field-label" htmlFor="api-key">
          Anthropic API key
        </label>
        <div className="input-wrap">
          <KeyRound size={17} />
          <input
            id="api-key"
            name="zemicc-ephemeral-credential"
            ref={input}
            type="password"
            placeholder="sk-ant-…"
            autoComplete="new-password"
            autoCapitalize="none"
            spellCheck={false}
            required
            minLength={12}
            maxLength={512}
            autoFocus
          />
        </div>
        <div className="privacy-row">
          <ShieldCheck size={15} />
          <span>仅内存 · 不写入配置 · 直连 Anthropic</span>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary full" disabled={busy}>
          {busy ? "正在连接…" : connected ? "更换本次密钥" : "连接"}
          <ArrowUpRight size={16} />
        </button>
      </form>
      {connected && (
        <button
          className="text-button disconnect"
          onClick={async () => {
            await api("/credential", undefined, "DELETE");
            onChange();
            onClose();
          }}
        >
          <Unplug size={15} />
          断开并清除密钥
        </button>
      )}
      <p className="modal-footnote">
        密钥只用于当前进程；首次任务会验证 API
        额度。批准命令后，命令将以你的系统权限运行。
      </p>
    </Modal>
  );
}

function ProjectDialog({
  project,
  onClose,
  onSelected,
}: {
  project: string;
  onClose: () => void;
  onSelected: () => void;
}) {
  const [value, setValue] = useState(project),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function choose(native = false) {
    setBusy(true);
    setError("");
    try {
      await api(
        native ? "/project/pick" : "/project",
        native ? {} : { path: value },
      );
      onSelected();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="打开项目"
      subtitle="你的下一件作品，从这里开始。"
      onClose={onClose}
    >
      <button
        className="folder-pick"
        onClick={() => void choose(true)}
        disabled={busy}
      >
        <FolderOpen size={32} strokeWidth={1.3} />
        <span>选择文件夹</span>
        <ArrowUpRight size={17} />
      </button>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void choose();
        }}
      >
        <label className="field-label" htmlFor="project-path">
          或输入完整路径
        </label>
        <input
          className="text-input"
          id="project-path"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="C:\Projects\my-project"
          autoFocus
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary full" disabled={!value.trim() || busy}>
          打开项目
          <ArrowUpRight size={16} />
        </button>
      </form>
    </Modal>
  );
}

function ToolEntry({ entry }: { entry: Entry }) {
  const [open, setOpen] = useState(false);
  const toolIcon = ["Bash", "PowerShell"].includes(entry.tool || "") ? (
    <Terminal size={15} />
  ) : entry.tool === "Read" ? (
    <FileText size={15} />
  ) : (
    <Code2 size={15} />
  );
  let hint = "";
  try {
    const input = JSON.parse(entry.input || "{}");
    hint =
      input.description ||
      input.file_path ||
      input.command ||
      input.pattern ||
      "";
  } catch {
    /* collapsed detail remains available */
  }
  return (
    <div className={`tool-entry ${entry.state}`}>
      <button className="tool-summary" onClick={() => setOpen(!open)}>
        {toolIcon}
        <span className="tool-name">{entry.tool}</span>
        <span className="tool-hint">{hint}</span>
        {entry.state === "running" ? (
          <span className="spinner" />
        ) : entry.state === "denied" ? (
          <X size={14} />
        ) : (
          <Check size={14} />
        )}
        <ChevronRight size={13} className={open ? "rotated" : ""} />
      </button>
      {open && (
        <div className="tool-detail">
          <pre>{entry.input}</pre>
          {entry.text !== entry.tool && <pre>{entry.text}</pre>}
        </div>
      )}
    </div>
  );
}

function ApprovalCard({
  approval,
  sessionId,
  onError,
}: {
  approval: Approval;
  sessionId: string;
  onError: (s: string) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false);
  async function respond(allow: boolean) {
    setBusy(true);
    try {
      await api(`/sessions/${sessionId}/approvals/${approval.id}`, {
        allow,
        answers: approval.questions ? answers : undefined,
      });
    } catch (e) {
      onError((e as Error).message);
      setBusy(false);
    }
  }
  const input = approval.input;
  const detail =
    typeof input.command === "string"
      ? input.command
      : JSON.stringify(input, null, 2);
  return (
    <div className="approval-card">
      <div className="approval-title">
        <ShieldCheck size={18} />
        <strong>{approval.questions ? "需要你的选择" : "确认这一步"}</strong>
        <span>{approval.tool}</span>
      </div>
      {approval.questions ? (
        approval.questions.map((q) => (
          <fieldset className="question" key={q.question}>
            <legend>{q.question}</legend>
            <div className="question-options">
              {q.options.map((o) => {
                const selected = q.multiSelect
                  ? (answers[q.question] || "").split(", ").includes(o.label)
                  : answers[q.question] === o.label;
                return (
                  <button
                    type="button"
                    key={o.label}
                    className={selected ? "selected" : ""}
                    title={o.description}
                    onClick={() =>
                      setAnswers((a) => {
                        const labels = (a[q.question] || "")
                          .split(", ")
                          .filter(Boolean);
                        return {
                          ...a,
                          [q.question]: q.multiSelect
                            ? (selected
                                ? labels.filter((x) => x !== o.label)
                                : [...labels, o.label]
                              ).join(", ")
                            : o.label,
                        };
                      })
                    }
                  >
                    {o.label}
                    {selected && <Check size={14} />}
                  </button>
                );
              })}
            </div>
            <input
              className="text-input"
              value={answers[q.question] || ""}
              onChange={(e) =>
                setAnswers((a) => ({ ...a, [q.question]: e.target.value }))
              }
              placeholder="也可以直接输入回答"
            />
          </fieldset>
        ))
      ) : (
        <>
          <p>
            {String(
              approval.reason ||
                input.description ||
                (["Bash", "PowerShell"].includes(approval.tool)
                  ? "此命令以你的本机权限运行，请检查后执行。"
                  : "检查内容，然后决定是否允许。"),
            )}
          </p>
          <pre>{detail}</pre>
        </>
      )}
      <div className="approval-actions">
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void respond(false)}
        >
          拒绝
        </button>
        <button
          className="primary"
          disabled={
            busy ||
            !!approval.questions?.some((q) => !answers[q.question]?.trim())
          }
          onClick={() => void respond(true)}
        >
          <Check size={15} />
          {approval.questions ? "继续" : "允许这一次"}
        </button>
      </div>
    </div>
  );
}

function FileTree({
  session,
  project,
  onOpen,
}: {
  session?: string;
  project: string;
  onOpen: (file: string, diff?: boolean) => void;
}) {
  const [cache, setCache] = useState<Record<string, FileItem[]>>({}),
    [open, setOpen] = useState<Set<string>>(new Set(["."])),
    [error, setError] = useState("");
  const suffix = session ? `&session=${session}` : "";
  async function load(dir: string) {
    try {
      const files = await api<FileItem[]>(
        `/files?path=${encodeURIComponent(dir)}${suffix}`,
      );
      setCache((c) => ({ ...c, [dir]: files }));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    setCache({});
    setOpen(new Set(["."]));
    if (project) void load(".");
  }, [session, project]);
  function render(dir: string, level = 0): ReactNode {
    return cache[dir]?.map((f) => (
      <div key={f.path}>
        <button
          className="tree-row"
          style={{ paddingLeft: 14 + level * 13 }}
          title={f.path}
          onClick={() => {
            if (!f.directory) {
              onOpen(f.path);
              return;
            }
            setOpen((s) => {
              const n = new Set(s);
              if (n.has(f.path)) n.delete(f.path);
              else n.add(f.path);
              return n;
            });
            if (!cache[f.path]) void load(f.path);
          }}
        >
          {f.directory ? (
            <ChevronRight
              size={12}
              className={open.has(f.path) ? "rotated" : ""}
            />
          ) : (
            <span className="tree-spacer" />
          )}
          {f.directory ? (
            <Folder size={14} />
          ) : /\.(ts|tsx|js|gd|py|json|godot|tscn)$/.test(f.name) ? (
            <FileCode2 size={14} />
          ) : (
            <FileText size={14} />
          )}
          <span>{f.name}</span>
        </button>
        {f.directory && open.has(f.path) && render(f.path, level + 1)}
      </div>
    ));
  }
  return (
    <>
      <div className="inspector-subheading">
        <span>文件</span>
        <IconButton
          label="刷新文件"
          onClick={() => {
            setCache({});
            setOpen(new Set(["."]));
            void load(".");
          }}
        >
          <RefreshCw size={13} />
        </IconButton>
      </div>
      {error ? (
        <p className="panel-empty">{error}</p>
      ) : !project ? (
        <p className="panel-empty">打开项目后查看文件</p>
      ) : (
        <div className="file-tree">
          {render(".")}
          {cache["."]?.length === 0 && (
            <p className="panel-empty">文件夹是空的</p>
          )}
        </div>
      )}
    </>
  );
}

function Inspector({
  project,
  session,
  onOpen,
  refresh,
}: {
  project: string;
  session?: Session;
  onOpen: (p: string, diff?: boolean) => void;
  refresh: number;
}) {
  const [tab, setTab] = useState<"files" | "changes">("files");
  const [git, setGit] = useState<{
    branch: string;
    changes: Change[];
    available: boolean;
  }>({ branch: "", changes: [], available: false });
  useEffect(() => {
    if (project)
      void api<typeof git>(`/changes${session ? `?session=${session.id}` : ""}`)
        .then(setGit)
        .catch(() => setGit({ branch: "", changes: [], available: false }));
  }, [project, session?.id, session?.phase, refresh]);
  return (
    <aside className="inspector">
      <div className="inspector-heading">
        <Layers2 size={16} />
        <span>项目概览</span>
      </div>
      <div className="project-card">
        <div className="project-folder">
          <FolderOpen size={26} strokeWidth={1.3} />
        </div>
        <div className="project-card-name">{basename(project)}</div>
        <div className="project-card-path" title={project}>
          {project || "还没有打开文件夹"}
        </div>
        {git.available && (
          <div className="branch">
            <GitBranch size={12} />
            {git.branch}
          </div>
        )}
      </div>
      <div className="inspector-tabs">
        <button
          className={tab === "files" ? "selected" : ""}
          onClick={() => setTab("files")}
        >
          <Folder size={14} />
          文件
        </button>
        <button
          className={tab === "changes" ? "selected" : ""}
          onClick={() => setTab("changes")}
        >
          <GitCompareArrows size={14} />
          变更{git.changes.length > 0 && <span>{git.changes.length}</span>}
        </button>
      </div>
      <div className="inspector-content">
        {tab === "files" ? (
          <FileTree project={project} session={session?.id} onOpen={onOpen} />
        ) : (
          <div className="changes-list">
            {git.changes.length ? (
              git.changes.map((c) => (
                <button
                  key={c.path}
                  className="change-row"
                  title={c.path}
                  onClick={() => onOpen(c.path, c.status !== "??")}
                >
                  <span
                    className={`change-status ${c.status.includes("D") ? "deleted" : ""}`}
                  >
                    {c.status}
                  </span>
                  <span>{c.path}</span>
                  <ChevronRight size={12} />
                </button>
              ))
            ) : (
              <div className="changes-empty">
                <Check size={25} strokeWidth={1.3} />
                <p>
                  {git.available ? "工作区很干净" : "这个项目没有 Git 仓库"}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="inspector-footer">
        <div>
          <span>累计输入</span>
          <span>
            {compact(session?.usage.input || 0)}{" "}
            <span className="muted">tokens</span>
          </span>
        </div>
        <div>
          <span>累计估算费用</span>
          <span>${(session?.usage.cost || 0).toFixed(3)}</span>
        </div>
        <div className="local-note">
          <ShieldCheck size={13} />
          <span>本地工作区</span>
          <span className="tiny-dot" />
        </div>
      </div>
    </aside>
  );
}

function Hero({
  project,
  onPrompt,
}: {
  project: string;
  onPrompt: (value: string) => void;
}) {
  const cards = [
    {
      icon: <Search size={19} />,
      title: "读懂项目",
      note: "结构与关键入口",
      prompt:
        "请先阅读这个项目，用简洁的中文说明项目结构、技术栈和关键入口。只读分析，不修改文件。",
    },
    {
      icon: <Code2 size={19} />,
      title: "一起构建",
      note: "把想法变成代码",
      prompt:
        "我想为这个项目实现一个新功能。请先了解项目，再问我希望实现什么。",
    },
    {
      icon: <GitCompareArrows size={19} />,
      title: "检查代码",
      note: "发现值得改进的地方",
      prompt:
        "请审查这个项目，优先查找可复现的 bug。先只读检查，给出文件位置和修复建议。",
    },
  ];
  return (
    <div className="hero">
      <div className="orbit-art" aria-hidden="true">
        <div className="orbit orbit-one" />
        <div className="orbit orbit-two" />
        <div className="orbit orbit-three" />
        <span className="orbit-dot dot-one" />
        <span className="orbit-dot dot-two" />
        <div className="hero-mark">
          <Mark size={64} />
        </div>
        <div className="floating-glyph glyph-code">
          <Code2 size={18} />
        </div>
        <div className="floating-glyph glyph-folder">
          <Folder size={18} />
        </div>
      </div>
      <div className="eyebrow">A LITTLE SPACE. A BIG IDEA.</div>
      <h1>让想法，落地。</h1>
      <p className="hero-subtitle">
        {project ? (
          <>
            从 <strong>{basename(project)}</strong> 开始，和你的 Agent
            一起创造。
          </>
        ) : (
          "打开一个项目，给下一个想法留点空间。"
        )}
      </p>
      <div className="starter-grid">
        {cards.map((c, i) => (
          <button
            className="starter-card"
            key={c.title}
            onClick={() => onPrompt(c.prompt)}
          >
            <span className={`starter-icon starter-${i}`}>{c.icon}</span>
            <span className="starter-copy">
              <strong>{c.title}</strong>
              <span>{c.note}</span>
            </span>
            <ArrowUpRight size={15} />
          </button>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const { zoom, change: changeZoom, browserZoomed } = useZoom();
  const [state, setState] = useState<Snapshot>({
    project: "",
    connected: false,
    permissionMode: "auto",
    sessions: [],
    version: "",
  });
  const [selected, setSelected] = useState<string>();
  const [model, setModel] = useState(MODELS[0].id);
  const [draft, setDraft] = useState(""),
    [connectionOpen, setConnectionOpen] = useState(false),
    [projectOpen, setProjectOpen] = useState(false),
    [permissionOpen, setPermissionOpen] = useState(false),
    [permissionSaving, setPermissionSaving] = useState(false),
    [inspector, setInspector] = useState(true);
  const [online, setOnline] = useState(false),
    [error, setError] = useState(""),
    [sending, setSending] = useState(false),
    [filter, setFilter] = useState(""),
    [searching, setSearching] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [preview, setPreview] = useState<{
    path: string;
    content: string;
    diff: boolean;
  }>();
  const [deleteId, setDeleteId] = useState<string>();
  const textarea = useRef<HTMLTextAreaElement>(null),
    scroll = useRef<HTMLDivElement>(null),
    stick = useRef(true);
  const current = state.sessions.find((s) => s.id === selected);
  const project = current?.project || state.project;
  const busy = current?.phase === "running" || current?.phase === "approval";
  const permissionMode = current?.permissionMode || state.permissionMode;
  useEffect(() => {
    let disposed = false,
      events: EventSource | undefined;
    void bootstrap()
      .then(async () => {
        const snapshot = await api<Snapshot>("/state");
        if (disposed) return;
        setState(snapshot);
        events = new EventSource("/api/events");
        events.onopen = () => setOnline(true);
        events.onerror = () => setOnline(false);
        events.onmessage = (event) => {
          const data = JSON.parse(event.data);
          if (data.type === "state") setState(data.state);
          if (data.type === "connection")
            setState((s) => ({ ...s, connected: data.connected }));
          if (data.type === "session")
            setState((s) => ({
              ...s,
              sessions: [
                ...s.sessions.filter((x) => x.id !== data.session.id),
                data.session,
              ].sort((a, b) => b.updated - a.updated),
            }));
        };
      })
      .catch((e) => setError(e.message));
    return () => {
      disposed = true;
      events?.close();
    };
  }, []);
  useEffect(() => {
    if (stick.current)
      scroll.current?.scrollTo({
        top: scroll.current.scrollHeight,
        behavior: "smooth",
      });
  }, [current?.entries, current?.approvals]);
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(""), 7000);
    return () => clearTimeout(t);
  }, [error]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        setSelected(undefined);
        setDraft("");
        textarea.current?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  async function reload() {
    setState(await api<Snapshot>("/state"));
  }
  async function changePermission(mode: PermissionMode) {
    setPermissionSaving(true);
    try {
      setState(
        await api<Snapshot>("/permissions", { mode, sessionId: current?.id }),
      );
      setPermissionOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPermissionSaving(false);
    }
  }
  async function send() {
    if (!draft.trim() || busy || sending) return;
    if (!project) {
      setProjectOpen(true);
      return;
    }
    if (!state.connected) {
      setConnectionOpen(true);
      return;
    }
    setSending(true);
    let text = draft.trim();
    try {
      let session = current;
      if (!session) {
        session = await api<Session>("/sessions", { model });
        setSelected(session.id);
      }
      stick.current = true;
      await api(`/sessions/${session.id}/send`, { text, model });
      setDraft("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  async function openFile(file: string, diff = false) {
    try {
      const data = await api<{ content: string }>(
        `/${diff ? "diff" : "file"}?path=${encodeURIComponent(file)}${current ? `&session=${current.id}` : ""}`,
      );
      setPreview({ path: file, content: data.content, diff });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const choosePrompt = (value: string) => {
    setDraft(value);
    textarea.current?.focus();
  };
  const visibleSessions = state.sessions
    .filter((s) => !state.project || s.project === state.project)
    .filter((s) => s.title.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div
      className={`app ${inspector ? "" : "inspector-hidden"} ${browserZoomed ? "browser-zoomed" : ""}`}
    >
      <aside className="sidebar">
        <div className="brand">
          <Mark />
          <span>
            zemi<span className="brand-cc">CC</span>
          </span>
          <span className="brand-dot" />
        </div>
        <button className="project-switch" onClick={() => setProjectOpen(true)}>
          <span className="project-switch-icon">
            <FolderOpen size={18} />
          </span>
          <span>
            <small>工作空间</small>
            <strong>{basename(state.project)}</strong>
          </span>
          <ChevronDown size={14} />
        </button>
        <button
          className="new-session"
          onClick={() => {
            setSelected(undefined);
            setDraft("");
            textarea.current?.focus();
          }}
        >
          <Plus size={17} />
          <span>新建对话</span>
          <kbd>Ctrl N</kbd>
        </button>
        <div className="sidebar-label">
          <span>最近对话</span>
          <IconButton
            label="搜索会话"
            active={searching}
            onClick={() => {
              setSearching(!searching);
              setFilter("");
            }}
          >
            <Search size={14} />
          </IconButton>
        </div>
        {searching && (
          <input
            className="session-search"
            aria-label="搜索会话"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="搜索…"
            autoFocus
          />
        )}
        <div className="sessions">
          {visibleSessions.length ? (
            visibleSessions.map((s) => (
              <div
                key={s.id}
                className={`session-row ${s.id === selected ? "selected" : ""}`}
              >
                <button
                  className="session-main"
                  onClick={() => {
                    setSelected(s.id);
                    setModel(s.model);
                    stick.current = true;
                  }}
                >
                  <MessageSquare size={14} />
                  <span>{s.title}</span>
                  {["running", "approval"].includes(s.phase) && (
                    <span className={`session-dot ${s.phase}`} />
                  )}
                </button>
                <IconButton
                  label={`删除对话 ${s.title}`}
                  className="session-delete"
                  onClick={() => setDeleteId(s.id)}
                >
                  <Trash2 size={12} />
                </IconButton>
              </div>
            ))
          ) : (
            <div className="no-sessions">
              <span className="conversation-line" />
              <span className="conversation-line short" />
              <p>{filter ? "没有匹配的对话" : "新的想法，会留在这里"}</p>
            </div>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="local-badge">
            <span className={`status-dot ${online ? "online" : ""}`} />
            <span>{online ? "本地运行" : "服务未连接"}</span>
            <span>{state.version ? `v${state.version}` : ""}</span>
          </div>
          <button
            className="connection-button"
            onClick={() => setConnectionOpen(true)}
          >
            <div className={`key-avatar ${state.connected ? "connected" : ""}`}>
              <KeyRound size={18} />
            </div>
            <span>
              <strong>{state.connected ? "密钥已载入" : "连接 Claude"}</strong>
              <small>
                {state.connected ? "仅本次运行" : "使用你的 API key"}
              </small>
            </span>
            <Settings2 size={16} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumbs">
            <span className="breadcrumb-project">{basename(project)}</span>
            <ChevronRight size={13} />
            <span>{current ? current.title : "新的对话"}</span>
          </div>
          <div className="topbar-actions">
            <div className="zoom-controls" role="group" aria-label="界面缩放">
              <IconButton
                label="缩小界面 · Ctrl −"
                onClick={() => changeZoom(zoom - 0.1)}
                disabled={zoom <= 0.8}
              >
                <span className="zoom-symbol">−</span>
              </IconButton>
              <button
                className="zoom-reset"
                title="恢复默认大小 · Ctrl 0"
                aria-label="恢复默认缩放"
                onClick={() => changeZoom(1)}
              >
                {Math.round(zoom * 100)}%
              </button>
              <IconButton
                label="放大界面 · Ctrl +"
                onClick={() => changeZoom(zoom + 0.1)}
                disabled={zoom >= 1.8}
              >
                <Plus size={17} />
              </IconButton>
            </div>
            {current && (
              <span className={`phase-label ${current.phase}`}>
                <span className={busy ? "spinner" : "status-dot online"} />
                {phaseText[current.phase]}
              </span>
            )}
            <span className="sdk-tag">Claude Agent SDK</span>
            <IconButton
              label={inspector ? "收起项目概览" : "展开项目概览"}
              onClick={() => setInspector(!inspector)}
            >
              {inspector ? (
                <PanelRightClose size={18} />
              ) : (
                <PanelRightOpen size={18} />
              )}
            </IconButton>
          </div>
        </header>
        <div className="workspace-body">
          <main className="conversation">
            <div
              ref={scroll}
              className="conversation-scroll"
              onScroll={() => {
                const el = scroll.current;
                if (el)
                  stick.current =
                    el.scrollHeight - el.scrollTop - el.clientHeight < 100;
              }}
            >
              {!current || !current.entries.length ? (
                <Hero project={project} onPrompt={choosePrompt} />
              ) : (
                <div className="messages">
                  <div className="session-date">
                    {new Date(current.created).toLocaleDateString("zh-CN", {
                      month: "long",
                      day: "numeric",
                    })}
                    <span />
                    本地会话
                  </div>
                  {current.entries.map((entry) =>
                    entry.kind === "tool" ? (
                      <ToolEntry key={entry.id} entry={entry} />
                    ) : entry.kind === "notice" ? (
                      <div className="notice" key={entry.id}>
                        <Circle size={9} />
                        {entry.text}
                      </div>
                    ) : entry.kind === "error" ? (
                      <div className="error-card" key={entry.id}>
                        <span>连接遇到问题</span>
                        <p>{entry.text}</p>
                        <button
                          className="text-button"
                          onClick={() => {
                            setDraft(
                              current.entries
                                .filter((e) => e.kind === "user")
                                .at(-1)?.text || "",
                            );
                            textarea.current?.focus();
                          }}
                        >
                          <RefreshCw size={13} />
                          重新编辑并发送
                        </button>
                      </div>
                    ) : (
                      <article
                        className={`message ${entry.kind}`}
                        key={entry.id}
                      >
                        {entry.kind === "assistant" && (
                          <div className="assistant-avatar">
                            <Mark size={25} />
                          </div>
                        )}
                        <div className="message-content">
                          {entry.kind === "assistant" ? (
                            <Markdown text={entry.text} />
                          ) : (
                            <p>{entry.text}</p>
                          )}
                        </div>
                      </article>
                    ),
                  )}
                  {current.approvals.map((a) => (
                    <ApprovalCard
                      key={a.id}
                      approval={a}
                      sessionId={current.id}
                      onError={setError}
                    />
                  ))}
                  {current.phase === "running" && (
                    <div className="working-indicator">
                      <span />
                      <span />
                      <span />
                      <small>正在工作</small>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="composer-area">
              <div className={`composer ${busy ? "busy" : ""}`}>
                <textarea
                  ref={textarea}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={
                    busy ? "Agent 正在工作…" : "描述你的想法，剩下的一起完成…"
                  }
                  aria-label="消息"
                  rows={3}
                  maxLength={30000}
                  disabled={busy}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                <div className="composer-toolbar">
                  <div className="composer-left">
                    <IconButton
                      label="浏览项目文件"
                      onClick={() => setInspector(true)}
                    >
                      <Plus size={17} />
                    </IconButton>
                    <div className="model-select">
                      <span className="model-dot" />
                      <select
                        aria-label="选择模型"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        disabled={busy}
                      >
                        {MODELS.map((m) => (
                          <option value={m.id} key={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={12} />
                    </div>
                  </div>
                  <div className="composer-right">
                    <button
                      type="button"
                      className={`permission-chip ${permissionMode}`}
                      aria-label="权限模式"
                      aria-haspopup="dialog"
                      title={
                        current?.permissionFallback
                          ? "自动命令审核暂不可用，命令将请求确认"
                          : "切换权限模式"
                      }
                      onClick={() => setPermissionOpen(true)}
                    >
                      {permissionMode === "auto" ? (
                        <Sparkles size={14} />
                      ) : (
                        <ShieldCheck size={14} />
                      )}
                      {permissionMode === "auto"
                        ? current?.permissionFallback
                          ? "自动 · 命令确认"
                          : "智能自动"
                        : "逐次确认"}
                      <ChevronDown size={12} />
                    </button>
                    {busy ? (
                      <button
                        className="send-button stop"
                        aria-label="停止生成"
                        title="停止生成"
                        onClick={() =>
                          void api(`/sessions/${current!.id}/stop`, {}).catch(
                            (e) => setError(e.message),
                          )
                        }
                      >
                        <Square size={14} fill="currentColor" />
                      </button>
                    ) : (
                      <button
                        className="send-button"
                        disabled={!draft.trim() || sending || !online}
                        title="发送 · Enter"
                        aria-label="发送消息"
                        onClick={() => void send()}
                      >
                        {sending ? (
                          <span className="spinner" />
                        ) : (
                          <ArrowUp size={20} />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className="composer-caption">
                <span>
                  <LockKeyhole size={11} />
                  {state.connected ? "密钥只在内存中" : "连接密钥后即可开始"}
                </span>
                <span>
                  <CornerDownLeft size={11} />
                  发送<span className="caption-separator">·</span>Shift + Enter
                  换行
                </span>
              </div>
            </div>
          </main>
          {inspector && (
            <Inspector
              project={project}
              session={current}
              onOpen={(p, diff) => void openFile(p, diff)}
              refresh={refresh}
            />
          )}
        </div>
      </div>
      {connectionOpen && (
        <Connection
          connected={state.connected}
          onClose={() => setConnectionOpen(false)}
          onChange={() => void reload()}
        />
      )}
      {permissionOpen && (
        <Modal
          title="权限模式"
          subtitle="让日常工作自然进行，重要操作由你决定。"
          onClose={() => setPermissionOpen(false)}
        >
          <div
            className="permission-options"
            role="radiogroup"
            aria-label="选择权限模式"
          >
            {(
              [
                {
                  mode: "auto",
                  label: "智能自动",
                  description: "日常操作自动继续，由 SDK 判断命令风险。",
                  icon: <Sparkles size={21} />,
                },
                {
                  mode: "manual",
                  label: "逐次确认",
                  description: "文件变更、搜索与命令逐次确认。",
                  icon: <ShieldCheck size={21} />,
                },
              ] as const
            ).map((option) => (
              <button
                type="button"
                role="radio"
                aria-checked={permissionMode === option.mode}
                key={option.mode}
                className={`permission-option ${permissionMode === option.mode ? "selected" : ""}`}
                disabled={busy || permissionSaving || !online}
                onClick={() => void changePermission(option.mode)}
              >
                <span className="permission-option-icon">{option.icon}</span>
                <span>
                  <strong>
                    {option.label}
                    {option.mode === "auto" && <small>推荐</small>}
                  </strong>
                  <span>{option.description}</span>
                </span>
                <span className="permission-radio">
                  {permissionMode === option.mode && <Check size={14} />}
                </span>
              </button>
            ))}
          </div>
          <div className="permission-boundary">
            <ShieldCheck size={17} />
            <span>
              Claude Agent SDK 原生自动审核
              <span>需要人工授权时再确认，凭据保护始终保留。</span>
            </span>
          </div>
          <p className="permission-note">
            {busy
              ? "当前任务结束或停止后，即可切换。"
              : "应用于当前对话及新对话。命令以你的本机权限运行。"}
          </p>
        </Modal>
      )}
      {projectOpen && (
        <ProjectDialog
          project={state.project}
          onClose={() => setProjectOpen(false)}
          onSelected={() => {
            setSelected(undefined);
            void reload();
            setRefresh((r) => r + 1);
          }}
        />
      )}
      {preview && (
        <Modal
          title={basename(preview.path)}
          subtitle={preview.path}
          wide
          onClose={() => setPreview(undefined)}
        >
          <div className="preview-toolbar">
            <span>{preview.diff ? "Git diff · 相对 HEAD" : "文件预览"}</span>
            <button
              className="text-button"
              onClick={() => {
                setDraft(
                  (d) => `${d}${d ? "\n" : ""}请查看项目文件：${preview.path}`,
                );
                setPreview(undefined);
                textarea.current?.focus();
              }}
            >
              <Plus size={14} />
              加入消息
            </button>
          </div>
          <pre className={`file-preview ${preview.diff ? "diff-preview" : ""}`}>
            {preview.content
              ? preview.content.split("\n").map((line, i) => (
                  <div
                    key={i}
                    className={
                      preview.diff && line.startsWith("+")
                        ? "diff-add"
                        : preview.diff && line.startsWith("-")
                          ? "diff-remove"
                          : ""
                    }
                  >
                    <span className="line-number">{i + 1}</span>
                    <code>{line || " "}</code>
                  </div>
                ))
              : "没有可显示的差异"}
          </pre>
        </Modal>
      )}
      {deleteId && (
        <Modal
          title="删除这段对话？"
          subtitle="只删除本地对话记录，项目文件不受影响。"
          onClose={() => setDeleteId(undefined)}
        >
          <div className="approval-actions">
            <button
              className="secondary"
              onClick={() => setDeleteId(undefined)}
            >
              保留
            </button>
            <button
              className="primary danger"
              onClick={async () => {
                try {
                  await api(`/sessions/${deleteId}`, undefined, "DELETE");
                  if (selected === deleteId) setSelected(undefined);
                  setDeleteId(undefined);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              删除
            </button>
          </div>
        </Modal>
      )}
      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <IconButton label="关闭提示" onClick={() => setError("")}>
            <X size={15} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
