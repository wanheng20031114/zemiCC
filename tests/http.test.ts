import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { startServer } from "../server/index.js";

test("local API authenticates, blocks hostile origins, clears credentials and does not persist them", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zemicc-http-test-"));
  const server = await startServer({ port: 0, dataDir: dir });
  try {
    assert.equal((await fetch(server.url + "/api/state")).status, 401);
    assert.equal((await fetch(server.url + "/api/bootstrap")).status, 403);
    assert.equal(
      (
        await fetch(server.url + "/api/bootstrap", {
          headers: { origin: "https://evil.example", "x-zemicc-client": "1" },
        })
      ).status,
      403,
    );
    const bootstrap = await fetch(server.url + "/api/bootstrap", {
      headers: { "x-zemicc-client": "1" },
    });
    const { token } = (await bootstrap.json()) as { token: string };
    const cookie = bootstrap.headers.get("set-cookie")!.split(";")[0];
    assert.ok(bootstrap.headers.get("set-cookie")!.includes("HttpOnly"));
    const headers = {
      "content-type": "application/json",
      "x-zemicc-token": token,
      cookie,
    };
    const key = "test-only-secret-never-real-123";
    assert.equal(
      (
        await fetch(server.url + "/api/permissions", {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ mode: "manual" }),
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(server.url + "/api/permissions", {
          method: "POST",
          headers,
          body: JSON.stringify({ mode: "bypassPermissions" }),
        })
      ).status,
      400,
    );
    const permissions = await fetch(server.url + "/api/permissions", {
      method: "POST",
      headers,
      body: JSON.stringify({ mode: "manual" }),
    });
    assert.equal(permissions.status, 200);
    assert.equal(
      ((await permissions.json()) as { permissionMode: string }).permissionMode,
      "manual",
    );
    assert.equal(
      (
        await fetch(server.url + "/api/credential", {
          method: "POST",
          headers,
          body: JSON.stringify({ key }),
        })
      ).status,
      200,
    );
    let state = (await (
      await fetch(server.url + "/api/state", { headers })
    ).json()) as { connected: boolean };
    assert.equal(state.connected, true);
    assert.ok(!JSON.stringify(state).includes(key));
    assert.equal(
      (
        await fetch(server.url + "/api/credential", {
          method: "DELETE",
          headers: { cookie },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(server.url + "/api/credential", {
          method: "DELETE",
          headers: { ...headers, origin: "http://127.0.0.1:9999" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(server.url + "/api/credential", {
          method: "DELETE",
          headers,
        })
      ).status,
      200,
    );
    state = (await (
      await fetch(server.url + "/api/state", { headers })
    ).json()) as { connected: boolean };
    assert.equal(state.connected, false);
    const saved = await fs.readFile(path.join(dir, "workspace.json"), "utf8");
    assert.ok(!saved.includes(key));
  } finally {
    await server.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
