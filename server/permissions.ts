import path from "node:path";
import type { PermissionMode } from "../shared/types.js";
import { privatePath, safePath } from "./security.js";

export type ToolPolicy = {
  behavior: "allow" | "ask" | "deny" | "defer";
  input: Record<string, unknown>;
  reason?: string;
};

// Keep a credential-specific review trigger. The SDK's native auto classifier
// evaluates every other complete command, including pipelines, substitutions,
// redirections and background commands. A keyword or ../ alone is not a reason
// for the app to force a human prompt. Never turn this into a shell allowlist.
export function commandReviewReason(command: string) {
  if (
    /(?:^|[\s/\\'"=])\.env(?:\b|\.)|\.(?:pem|pfx|p12|key)\b|\b(?:printenv|setenv|credentials|id_rsa|id_ed25519)\b|\benv:|\$env(?::|\b)|process\s*\.\s*env|os\s*\.\s*environ|\$(?:ANTHROPIC|AWS|OPENAI|GITHUB)_|[./\\](?:\.ssh|\.aws|\.azure)\b/i.test(
      command,
    )
  )
    return "此命令涉及环境变量、密钥或凭据文件";
  return undefined;
}

const SOURCE_GLOB =
  "*.{ts,tsx,js,jsx,mjs,cjs,gd,gdshader,godot,tscn,tres,py,rs,go,c,cpp,h,hpp,cs,java,kt,swift,html,css,scss,md,txt,json,yaml,yml,toml,xml,svg,sh,ps1}";

export async function toolPolicy(
  project: string,
  mode: PermissionMode,
  tool: string,
  original: Record<string, unknown>,
): Promise<ToolPolicy> {
  const input = { ...original };
  const result = (
    behavior: ToolPolicy["behavior"],
    reason?: string,
  ): ToolPolicy => ({ behavior, input, reason });
  try {
    if (["Read", "Write", "Edit", "MultiEdit", "NotebookEdit"].includes(tool)) {
      const field = tool === "NotebookEdit" ? "notebook_path" : "file_path";
      if (typeof input[field] !== "string")
        return result("deny", "工具缺少文件路径");
      input[field] = await safePath(
        project,
        input[field] as string,
        tool !== "Read",
      );
      return tool === "Read" || mode === "auto"
        ? result("allow")
        : result("ask", "逐次确认模式：检查文件变更");
    }
    if (["Glob", "Grep"].includes(tool)) {
      input.path = await safePath(
        project,
        typeof input.path === "string" ? input.path : ".",
      );
      const pattern = tool === "Glob" ? input.pattern : input.glob;
      if (
        typeof pattern === "string" &&
        (/(^|[\\/])\.\.([\\/]|$)/.test(pattern) ||
          path.isAbsolute(pattern) ||
          privatePath(pattern))
      )
        return result("deny", "搜索范围必须是项目内的非敏感文件");
      if (tool === "Grep") {
        // Keep content searches on source/document files. A missing glob gets a
        // useful default instead of interrupting every ordinary project search.
        if (input.glob === undefined) input.glob = SOURCE_GLOB;
        else if (
          typeof input.glob !== "string" ||
          /env|pem|credential|\*\*/i.test(input.glob)
        )
          return result(
            "deny",
            "请使用明确的源码文件 glob，例如 *.ts 或 *.gd，不要搜索凭据文件。",
          );
      }
      return tool === "Glob" || mode === "auto"
        ? result("allow")
        : result("ask", "逐次确认模式：检查搜索范围");
    }
    if (tool === "TodoWrite") return result("allow");
    if (tool === "AskUserQuestion") return result("ask");
    if (["Bash", "PowerShell"].includes(tool)) {
      if (typeof input.command !== "string" || !input.command.trim())
        return result("deny", "命令为空");
      const reason = commandReviewReason(input.command);
      if (reason) return result("ask", reason);
      return mode === "manual"
        ? result("ask", "逐次确认模式：检查此命令")
        : result("defer");
    }
    return result("ask", "此工具需要你确认");
  } catch (error) {
    return result("deny", (error as Error).message);
  }
}
