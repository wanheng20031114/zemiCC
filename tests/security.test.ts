import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  CredentialVault,
  safePath,
  sdkEnvironment,
} from "../server/security.js";
import { AgentHost } from "../server/agent.js";

test("credentials stay private and exact values are removed from persisted history", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zemicc-vault-test-"));
  const host = new AgentHost(dir);
  await host.init();
  const key = "test-credential-that-must-never-persist";
  host.vault.set(key);
  assert.equal(JSON.stringify(host.vault), "{}");
  const s = await host.create(dir, "claude-haiku-5-5");
  host.add(s, "assistant", `Secret: ${key}`);
  await host.save();
  const saved = await fs.readFile(path.join(dir, "workspace.json"), "utf8");
  assert.ok(!saved.includes(key));
  assert.ok(saved.includes("[REDACTED]"));
  await host.close();
  assert.equal(host.vault.connected, false);
  const restored = new AgentHost(dir);
  await restored.init();
  assert.equal(restored.vault.connected, false);
  assert.equal(restored.get(s.id).restored, true);
  await restored.close();
  await fs.rm(dir, { recursive: true, force: true });
});
test("path guards reject traversal, secrets and symlink ancestors of new files", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zemicc-path-test-"));
  const project = path.join(dir, "project"),
    outside = path.join(dir, "outside");
  await fs.mkdir(project);
  await fs.mkdir(outside);
  await fs.writeFile(path.join(project, "ok.ts"), "export {}");
  assert.equal(await safePath(project, "ok.ts"), path.join(project, "ok.ts"));
  await assert.rejects(safePath(project, "../outside/a.ts", true));
  await assert.rejects(safePath(project, ".env", true));
  await fs.symlink(
    outside,
    path.join(project, "escape"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(safePath(project, "escape/new.ts", true));
  // Remove only the known test-created link; never recursively follow a junction.
  await fs.unlink(path.join(project, "escape"));
  await fs.rm(dir, { recursive: true, force: true });
});
test("SDK environment excludes host credentials and gateway overrides", () => {
  process.env.ZEMICC_TEST_OTHER_SECRET = "do-not-inherit";
  const env = sdkEnvironment("test-only-credential", "/tmp/local-runtime");
  assert.equal(env.ANTHROPIC_BASE_URL, "https://api.anthropic.com");
  assert.equal(env.ZEMICC_TEST_OTHER_SECRET, undefined);
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(env.CLAUDE_CODE_ENTRYPOINT, undefined);
  delete process.env.ZEMICC_TEST_OTHER_SECRET;
});
test("writes wait for explicit approval, deny works and cancellation clears pending actions", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zemicc-approval-test-"));
  const host = new AgentHost(dir);
  await host.init();
  const s = await host.create(dir, "claude-haiku-5-5");
  const abort = new AbortController();
  const pending = host.permission(
    s,
    "Write",
    { file_path: path.join(dir, "new.txt"), content: "test" },
    abort.signal,
  );
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(s.phase, "approval");
  await host.decide(s.id, s.approvals[0].id, { allow: false });
  assert.equal((await pending).behavior, "deny");
  const next = host.permission(
    s,
    "Bash",
    { command: "echo test" },
    abort.signal,
  );
  await new Promise((r) => setTimeout(r, 10));
  abort.abort();
  assert.equal((await next).behavior, "deny");
  assert.equal(s.approvals.length, 0);
  await host.close();
  await fs.rm(dir, { recursive: true, force: true });
});
