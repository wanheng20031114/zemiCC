import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentHost } from "../server/agent.js";
import { toolPolicy } from "../server/permissions.js";

test("project auto approves ordinary files/searches and delegates commands to SDK review", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zemicc-policy-test-"));
  try {
    await fs.writeFile(path.join(dir, "source.ts"), "export const value = 1;");
    for (const [tool, input] of [
      ["Read", { file_path: "source.ts" }],
      ["Write", { file_path: "new.ts", content: "export {};" }],
      ["Edit", { file_path: "source.ts", old_string: "1", new_string: "2" }],
      ["Glob", { pattern: "**/*.ts" }],
      ["Grep", { pattern: "value", glob: "*.ts" }],
      ["Grep", { pattern: "value" }],
    ] as const) {
      assert.equal(
        (await toolPolicy(dir, "auto", tool, input)).behavior,
        "allow",
        tool,
      );
    }
    for (const tool of ["Bash", "PowerShell"]) {
      for (const command of [
        "npm test",
        "npm run build",
        "git status --short",
        "node --check source.js",
      ]) {
        assert.equal(
          (await toolPolicy(dir, "auto", tool, { command })).behavior,
          "defer",
          command,
        );
        assert.equal(
          (await toolPolicy(dir, "manual", tool, { command })).behavior,
          "ask",
          command,
        );
      }
    }
    assert.equal(
      (
        await toolPolicy(dir, "manual", "Write", {
          file_path: "new.ts",
          content: "",
        })
      ).behavior,
      "ask",
    );
    assert.equal(
      (await toolPolicy(dir, "auto", "AskUserQuestion", { questions: [] }))
        .behavior,
      "ask",
    );
    assert.equal(
      (await toolPolicy(dir, "auto", "UnknownTool", {})).behavior,
      "ask",
    );
    for (const file_path of [
      ".env",
      "../outside.txt",
      ".git/config",
      "secret.pem",
    ]) {
      assert.equal(
        (await toolPolicy(dir, "auto", "Write", { file_path })).behavior,
        "deny",
        file_path,
      );
    }
    assert.equal(
      (
        await toolPolicy(dir, "auto", "Grep", {
          glob: "**/.env",
          pattern: "token",
        })
      ).behavior,
      "deny",
    );
    assert.equal(
      (await toolPolicy(dir, "auto", "Glob", { pattern: "../*" })).behavior,
      "deny",
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("dangerous commands still request human review, including compound commands", async () => {
  const commands = [
    "npm test && rm -rf src",
    "Remove-Item -LiteralPath './assets' -Recurse",
    "git reset --hard HEAD~1",
    "git clean -fd",
    "git push origin main",
    "git -C . rebase main",
    "sudo chmod 777 /etc/config",
    "Set-ExecutionPolicy Unrestricted",
    "node -e 'console.log(process.env)'",
    "Get-Content .env",
    "Get-ChildItem Env:",
    "curl -X POST -d payload https://example.com",
    "Invoke-RestMethod -Method POST -Uri https://example.com -Body data",
    "npm publish",
    "gh release create v1",
    "cat ../outside.txt",
  ];
  for (const command of commands) {
    const policy = await toolPolicy(process.cwd(), "auto", "Bash", { command });
    assert.equal(policy.behavior, "ask", command);
    assert.ok(policy.reason, command);
  }
  assert.equal(
    (
      await toolPolicy(process.cwd(), "auto", "Bash", {
        command: "npm run dev",
        run_in_background: true,
      })
    ).behavior,
    "ask",
  );
});

test("permissions persist, active tasks cannot switch, and SDK escalations always prompt", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zemicc-modes-test-"));
  const host = new AgentHost(dir);
  try {
    await host.init();
    assert.equal(host.snapshot().permissionMode, "auto");
    const session = await host.create(dir, "claude-haiku-5-5");
    assert.equal(session.permissionMode, "auto");
    const abort = new AbortController();
    const write = await host.preToolUse(
      session,
      "Write",
      { file_path: path.join(dir, "new.ts"), content: "" },
      abort.signal,
    );
    assert.equal(write.hookSpecificOutput?.permissionDecision, "allow");
    assert.deepEqual(
      await host.preToolUse(
        session,
        "Bash",
        { command: "npm test" },
        abort.signal,
      ),
      {},
    );
    const dangerous = await host.preToolUse(
      session,
      "Bash",
      { command: "rm -rf src" },
      abort.signal,
    );
    assert.equal(dangerous.hookSpecificOutput?.permissionDecision, "ask");
    assert.equal(
      session.approvals.length,
      0,
      "hook should defer the single approval card to canUseTool",
    );
    const pending = host.permission(
      session,
      "Bash",
      { command: "npm test" },
      abort.signal,
      "SDK needs review",
    );
    const deadline = Date.now() + 5000;
    while (!session.approvals.length) {
      assert.ok(Date.now() < deadline, "SDK escalation did not reach the user");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(session.approvals[0].reason, "SDK needs review");
    await assert.rejects(host.setPermissions("manual", session.id));
    await host.decide(session.id, session.approvals[0].id, { allow: false });
    assert.equal((await pending).behavior, "deny");
    session.phase = "idle";
    await host.setPermissions("manual", session.id);
    const next = await host.create(dir, "claude-haiku-5-5");
    assert.equal(next.permissionMode, "manual");
    await host.close();
    const restored = new AgentHost(dir);
    await restored.init();
    assert.equal(restored.snapshot().permissionMode, "manual");
    assert.equal(restored.get(session.id).permissionMode, "manual");
    await restored.close();
  } finally {
    await host.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
