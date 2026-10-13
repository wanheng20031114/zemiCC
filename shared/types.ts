import type { McpView } from "./mcp.js";
import type { ImageAttachment } from "./images.js";
export type Phase = "idle" | "running" | "approval" | "error" | "interrupted";
export type PermissionMode = "auto" | "manual";
export type Entry = {
  id: string;
  kind: "user" | "assistant" | "tool" | "notice" | "error";
  text: string;
  images?: ImageAttachment[];
  tool?: string;
  input?: string;
  state?: "running" | "done" | "denied";
  delivery?: "pending" | "received" | "cancelled";
  time: number;
};
export type Question = {
  question: string;
  header?: string;
  options: { label: string; description?: string }[];
  multiSelect?: boolean;
};
export type Approval = {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  questions?: Question[];
  time: number;
  reason?: string;
};
export type Session = {
  id: string;
  title: string;
  project: string;
  model: string;
  permissionMode: PermissionMode;
  permissionFallback?: boolean;
  phase: Phase;
  entries: Entry[];
  approvals: Approval[];
  created: number;
  updated: number;
  usage: { input: number; output: number; cost: number };
  restored?: boolean;
};
export type Snapshot = {
  project: string;
  connected: boolean;
  permissionMode: PermissionMode;
  sessions: Session[];
  version: string;
  mcp: McpView[];
  mcpPending?: boolean;
};
export type FileItem = {
  name: string;
  path: string;
  directory: boolean;
  size: number;
};
export type Change = { path: string; status: string };
export const MODELS = [
  { id: "claude-opus-5-5", label: "Opus 5.5" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5" },
];
