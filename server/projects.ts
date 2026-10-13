import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { privatePath, safePath } from "./security.js";
import type { FileItem, Change } from "../shared/types.js";
const exec = promisify(execFile);
const ignored = new Set([
  "node_modules",
  ".godot",
  "dist",
  "dist-server",
  "build",
  "vendor",
  "__pycache__",
  ".venv",
]);
export async function projectRoot(input: string) {
  if (!path.isAbsolute(input)) throw new Error("请输入项目文件夹的完整路径");
  const root = await fs.realpath(input);
  if (!(await fs.stat(root)).isDirectory()) throw new Error("请选择文件夹");
  return root;
}
export async function listFiles(root: string, relative = ".") {
  const dir = await safePath(root, relative);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: FileItem[] = [];
  for (const entry of entries) {
    if (
      ignored.has(entry.name) ||
      privatePath(entry.name) ||
      entry.isSymbolicLink()
    )
      continue;
    const candidate = path.join(dir, entry.name);
    try {
      await safePath(root, candidate);
    } catch {
      continue;
    }
    const stat = await fs.stat(candidate);
    files.push({
      name: entry.name,
      path: path.relative(root, candidate).replaceAll("\\", "/"),
      directory: stat.isDirectory(),
      size: stat.size,
    });
  }
  return files
    .sort(
      (a, b) =>
        Number(b.directory) - Number(a.directory) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 500);
}
export async function readFile(root: string, relative: string) {
  const file = await safePath(root, relative);
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > 512_000)
    throw new Error("预览支持 500 KB 以内的文本文件");
  const buffer = await fs.readFile(file);
  if (buffer.includes(0)) throw new Error("这是二进制文件");
  return buffer.toString("utf8");
}
async function git(root: string, args: string[]) {
  const { stdout } = await exec(
    "git",
    ["--no-optional-locks", "-c", "core.quotepath=false", ...args],
    {
      cwd: root,
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
      encoding: "utf8",
    },
  );
  return stdout;
}
export async function gitChanges(root: string) {
  try {
    const [branch, raw] = await Promise.all([
      git(root, ["branch", "--show-current"]),
      git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=normal"]),
    ]);
    const chunks = raw.split("\0");
    const changes: Change[] = [];
    for (let i = 0; i < chunks.length; i++) {
      if (!chunks[i]) continue;
      const status = chunks[i].slice(0, 2),
        file = chunks[i].slice(3);
      if (/[RC]/.test(status)) i++;
      if (!privatePath(file))
        changes.push({ path: file, status: status.trim() });
    }
    return { branch: branch.trim() || "detached", changes, available: true };
  } catch {
    return { branch: "", changes: [], available: false };
  }
}
export async function fileDiff(root: string, relative: string) {
  await safePath(root, relative, true);
  return git(root, [
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "HEAD",
    "--",
    relative,
  ]);
}
