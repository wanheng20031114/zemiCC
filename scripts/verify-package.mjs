import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { extractFile, listPackage } from "@electron/asar";

const root = fileURLToPath(new URL("../", import.meta.url));
const unpacked = path.join(root, "release", "win-unpacked");
const archive = path.join(unpacked, "resources", "app.asar");
const readEntry = (name) => extractFile(archive, path.normalize(name));
const entries = listPackage(archive).map((name) =>
  name.replaceAll("\\", "/").replace(/^\//, ""),
);
const manifest = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8"),
);
const required = [
  "desktop/main.mjs",
  "desktop/preload.cjs",
  "desktop/assets/icon.png",
  "dist/index.html",
  "dist-server/server/index.js",
  "dist-server/server/agent.js",
  "dist-server/server/mcp.js",
  "dist-server/package.json",
  "node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
];
for (const name of required)
  assert.ok(entries.includes(name), `Missing ${name}`);
for (const name of entries) {
  assert.ok(
    /^(?:desktop|dist|dist-server|node_modules|package\.json|LICENSE|THIRD_PARTY_NOTICES\.md)(?:\/|$)/.test(
      name,
    ),
    `Unexpected package content: ${name}`,
  );
  assert.ok(
    !/(?:^|\/)(?:\.zemicc|\.git|\.env(?:\.[^/]*)?|workspace\.json|mcp-servers\.json(?:\.tmp)?|mcp-check-[^/]*|sdk-session-[^/]*)(?:\/|$)/.test(
      name,
    ),
    `Private data in package: ${name}`,
  );
  assert.ok(
    !/^node_modules\/(?:electron(?:-builder)?|typescript|tsx|sharp|@electron\/asar|@anthropic-ai\/claude-agent-sdk-(?:win32|linux|darwin)[^/]*)(?:\/|$)/.test(
      name,
    ),
    `Unexpected build or duplicate native dependency: ${name}`,
  );
  if (
    !name.startsWith("node_modules/") &&
    /\.(?:mjs|cjs|js|json|html|css)$/.test(name)
  ) {
    const content = readEntry(name).toString("utf8");
    assert.ok(
      !/(?:sk-ant-[\w-]{30,}|gh[pousr]_[\w]{30,})/.test(content),
      `Credential-like content: ${name}`,
    );
    assert.ok(
      !/C:(?:\\\\|\\|\/)Users(?:\\\\|\\|\/)/i.test(content),
      `Private user path: ${name}`,
    );
  }
}
for (const file of ["package.json", "dist-server/package.json"]) {
  assert.equal(
    JSON.parse(readEntry(file).toString()).version,
    manifest.version,
  );
}
const binary = path.join(unpacked, "resources", "agent", "claude.exe");
const source = path.join(
  root,
  "node_modules",
  "@anthropic-ai",
  "claude-agent-sdk-win32-x64",
  "claude.exe",
);
const hash = async (file) =>
  createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
assert.equal(
  await hash(binary),
  await hash(source),
  "Bundled Claude runtime differs from npm runtime",
);
for (const name of [
  "zemiCC.exe",
  "LICENSE.electron.txt",
  "LICENSES.chromium.html",
  "resources/agent/LICENSE.md",
  "resources/agent/README.md",
  "resources/licenses/claude-agent-sdk/README.md",
]) {
  assert.ok(
    (await fs.stat(path.join(unpacked, name))).isFile(),
    `Missing ${name}`,
  );
}
assert.ok(!(await fs.readdir(unpacked)).includes("electron.exe"));
assert.ok(
  (await fs.stat(archive)).size < 100 * 1024 * 1024,
  "ASAR unexpectedly includes large files",
);
console.log(
  `Package verified: zemiCC ${manifest.version}, ${entries.length} ASAR entries, bundled native agent, no user data or build tools.`,
);
