import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http, { type ServerResponse } from "node:http";
import { McpRegistry } from "../server/mcp.js";
import { CredentialVault } from "../server/security.js";
import { toolPolicy } from "../server/permissions.js";
import { startServer } from "../server/index.js";

test("MCP persists only public definitions, keeps auth in memory, and imports atomically", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zemicc-mcp-store-"));
  const vault = new CredentialVault();
  vault.set("primary-claude-credential-test");
  const mcp = new McpRegistry(dir, vault);
  const secret = 'mcp-private-value-with-"quotes"-and-\\slashes';
  try {
    await mcp.init();
    await mcp.import({
      mcpServers: {
        local: {
          command: process.execPath,
          args: ["server.mjs"],
          env: { SERVER_TOKEN: secret },
        },
        remote: {
          type: "http",
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer remote-private-credential" },
        },
      },
    });
    const saved = await fs.readFile(mcp.file, "utf8");
    assert.ok(!saved.includes("mcp-private-value"));
    assert.ok(!saved.includes("remote-private-credential"));
    assert.ok(!JSON.stringify(mcp.views()).includes("private-value"));
    const config = mcp.configs().local;
    assert.ok(config.type === "stdio");
    assert.equal(config.env?.ANTHROPIC_API_KEY, "");
    assert.equal(config.env?.SERVER_TOKEN, secret);
    assert.equal(
      vault.clean({ nested: [`echo ${secret}`] }).nested[0],
      "echo [REDACTED]",
    );
    assert.equal(vault.streamSafe(`hello ${secret.slice(0, 17)}`), "hello ");
    assert.equal(
      vault.redact(vault.streamSafe(`hello ${secret} done`)),
      "hello [REDACTED] done",
    );
    assert.equal(
      vault.redact("server echoed remote-private-credential"),
      "server echoed [REDACTED]",
    );
    assert.deepEqual(vault.clean({ [secret]: "value" }), {
      "[REDACTED]": "value",
    });
    for (const value of [
      {
        mcpServers: {
          bad: { command: "node", args: ["--api-key=hidden-value"] },
        },
      },
      {
        mcpServers: {
          bad: {
            type: "http",
            url: "https://example.com/mcp?token=hidden-value",
          },
        },
      },
      {
        mcpServers: {
          bad: { type: "http", url: "https://user:password@example.com/mcp" },
        },
      },
      { mcpServers: { bad: { type: "http", url: "http://example.com/mcp" } } },
      {
        mcpServers: {
          good: { command: "node" },
          bad: {
            command: "node",
            tools: [{ permission_policy: "always_allow" }],
          },
        },
      },
    ])
      await assert.rejects(mcp.import(value));
    assert.equal(await fs.readFile(mcp.file, "utf8"), saved);
    const restored = new McpRegistry(dir, new CredentialVault());
    await restored.init();
    assert.equal(restored.views()[0].status, "needs-secrets");
    assert.deepEqual(restored.configs(), {});
    await mcp.enable("local", false);
    assert.equal(mcp.views()[0].status, "disabled");
    assert.equal(mcp.configs().local, undefined);
    await mcp.remove("local");
    assert.deepEqual(mcp.names(), ["remote"]);
    await restored.close();
  } finally {
    await mcp.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("configured MCP tools defer to SDK auto review; manual and unknown provenance still prompt", async () => {
  const context = {
    names: ["fixture"],
    server: { name: "fixture", source: "dynamic" },
  };
  assert.equal(
    (await toolPolicy(process.cwd(), "auto", "mcp__fixture__echo", {}, context))
      .behavior,
    "defer",
  );
  assert.equal(
    (
      await toolPolicy(
        process.cwd(),
        "manual",
        "mcp__fixture__echo",
        {},
        context,
      )
    ).behavior,
    "ask",
  );
  for (const server of [
    undefined,
    { name: "fixture", source: "plugin" },
    { name: "other", source: "dynamic" },
  ])
    assert.equal(
      (
        await toolPolicy(
          process.cwd(),
          "auto",
          "mcp__fixture__echo",
          {},
          { names: ["fixture"], server },
        )
      ).behavior,
      "ask",
    );
});

test(
  "native SDK probes stdio, HTTP and SSE without a Claude key or tool execution",
  { timeout: 60_000 },
  async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zemicc-mcp-probe-"));
    const mcp = new McpRegistry(dir, new CredentialVault());
    let eventStream: ServerResponse | undefined;
    let toolCalls = 0,
      authenticated = 0;
    const responseFor = (message: {
      id?: number;
      method: string;
      params?: { protocolVersion: string };
    }) => {
      if (message.id === undefined) return undefined;
      if (message.method === "tools/call") toolCalls++;
      const result =
        message.method === "initialize"
          ? {
              protocolVersion: message.params!.protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: "http-fixture", version: "1" },
            }
          : message.method === "tools/list"
            ? {
                tools: [
                  {
                    name: "lookup",
                    description: "Local fixture",
                    inputSchema: { type: "object", properties: {} },
                  },
                ],
              }
            : {};
      return { jsonrpc: "2.0", id: message.id, result };
    };
    const server = http.createServer(async (req, res) => {
      if (req.headers.authorization === "Bearer fixture-remote-token")
        authenticated++;
      if (req.method === "GET" && req.url === "/sse") {
        eventStream = res;
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        });
        res.write("event: endpoint\ndata: /messages\n\n");
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(405);
        res.end();
        return;
      }
      let body = "";
      for await (const chunk of req) body += String(chunk);
      const result = responseFor(JSON.parse(body));
      if (req.url === "/messages") {
        res.writeHead(202);
        res.end();
        if (result)
          eventStream?.write(
            `event: message\ndata: ${JSON.stringify(result)}\n\n`,
          );
      } else if (!result) {
        res.writeHead(202);
        res.end();
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as { port: number }).port;
    try {
      await mcp.init();
      await mcp.import({
        mcpServers: {
          local: {
            command: process.execPath,
            args: [path.resolve("tests/fixtures/mcp-server.mjs")],
            env: { FIXTURE_TOKEN: "fixture-local-token" },
          },
          web: {
            type: "http",
            url: `http://127.0.0.1:${port}/mcp`,
            headers: { Authorization: "Bearer fixture-remote-token" },
          },
          legacy: {
            type: "sse",
            url: `http://127.0.0.1:${port}/sse`,
            headers: { Authorization: "Bearer fixture-remote-token" },
          },
        },
      });
      for (const name of ["local", "web", "legacy"]) {
        await mcp.probe(name);
        const view = mcp.views().find((item) => item.name === name)!;
        assert.equal(view.status, "ready", `${name}: ${view.error}`);
        assert.equal(view.tools.length, 1);
      }
      assert.equal(toolCalls, 0, "Connection tests must not call tools");
      assert.ok(authenticated > 0);
      assert.deepEqual(
        (await fs.readdir(dir)).filter((name) => name.startsWith("mcp-check-")),
        [],
      );
      assert.ok(
        !(await fs.readFile(mcp.file, "utf8")).includes("fixture-remote-token"),
      );
    } finally {
      await mcp.close();
      eventStream?.end();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.rm(dir, { recursive: true, force: true });
    }
  },
);

test("MCP API requires authentication, rejects edits during tasks, and returns no credential values", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zemicc-mcp-api-"));
  const server = await startServer({ port: 0, dataDir: dir });
  try {
    const bootstrap = await fetch(server.url + "/api/bootstrap", {
      headers: { "x-zemicc-client": "1" },
    });
    const { token } = (await bootstrap.json()) as { token: string };
    const headers = {
      "content-type": "application/json",
      "x-zemicc-token": token,
    };
    const body = JSON.stringify({
      mcpServers: {
        example: {
          type: "http",
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer confidential-mcp-token" },
        },
      },
    });
    assert.equal(
      (
        await fetch(server.url + "/api/mcp/import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        })
      ).status,
      401,
    );
    const imported = await fetch(server.url + "/api/mcp/import", {
      method: "POST",
      headers,
      body,
    });
    assert.equal(imported.status, 200);
    assert.ok(!(await imported.text()).includes("confidential-mcp-token"));
    const session = await server.host.create(dir, "claude-haiku-5-5");
    session.phase = "running";
    assert.equal(
      (
        await fetch(server.url + "/api/mcp/example", {
          method: "DELETE",
          headers,
        })
      ).status,
      400,
    );
    assert.equal(server.host.mcp.views().length, 1);
    session.phase = "idle";
    server.host.add(
      session,
      "assistant",
      '{"echo":"Bearer confidential-mcp-token"}',
    );
    await server.host.save();
    assert.ok(
      !(await fs.readFile(path.join(dir, "workspace.json"), "utf8")).includes(
        "confidential-mcp-token",
      ),
    );
    assert.equal(
      (
        await fetch(server.url + "/api/mcp/example", {
          method: "DELETE",
          headers,
        })
      ).status,
      200,
    );
    assert.equal(server.host.mcp.views().length, 0);
  } finally {
    await server.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
