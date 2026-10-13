import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { AgentHost, PromptQueue } from "../server/agent.js";

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zemicc-input-"));
  const host = new AgentHost(dir);
  await host.init();
  host.vault.set("local-interaction-test-credential");
  const session = await host.create(dir, "claude-haiku-5-5");
  const connections: unknown[] = [];
  const modes: string[] = [];
  const worker: Parameters<AgentHost["message"]>[1] = {
    query: {
      setModel: async () => {},
      setPermissionMode: async (mode: string) => {
        modes.push(mode);
      },
      setMcpServers: async (config: unknown) => {
        connections.push(config);
        return { added: [], removed: [], errors: {} };
      },
      mcpServerStatus: async () => [],
      close: () => {},
    } as unknown as Query,
    queue: new PromptQueue(),
    abort: new AbortController(),
    baseline: { input: 0, output: 0, cost: 0 },
    raw: new Map(),
    messageId: "",
    seen: new Set(),
    runtime: dir,
    mcpRevision: host.mcp.revision,
    mcpNames: [],
    pendingInput: new Set(),
  };
  host.workers.set(session.id, worker);
  return {
    host,
    session,
    worker,
    connections,
    modes,
    close: async () => {
      await host.close();
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

function result(ids: string[], queued = 0): SDKMessage {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    user_message_uuid: ids.at(-1),
    user_message_uuids: ids,
    queued_turn_count: queued,
    modelUsage: {},
    total_cost_usd: 0,
    result: "done",
  } as SDKMessage;
}

function assistant(id: string, text: string, uuid = randomUUID()): SDKMessage {
  return {
    type: "assistant",
    uuid,
    session_id: "fixture",
    parent_tool_use_id: null,
    message: { id, content: [{ type: "text", text }] },
  } as SDKMessage;
}

function stream(
  f: Awaited<ReturnType<typeof fixture>>,
  id: string,
  index: number,
  text: string,
) {
  f.host.message(f.session, f.worker, {
    type: "stream_event",
    event: { type: "message_start", message: { id } },
  } as SDKMessage);
  f.host.message(f.session, f.worker, {
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index,
      delta: { type: "text_delta", text },
    },
  } as SDKMessage);
}

test("final text replaces its streamed block when thinking changes the final array index", async () => {
  const f = await fixture();
  try {
    stream(f, "msg_thinking", 1, "先看一下当前的状态。");
    const final = assistant("msg_thinking", "先看一下当前的状态。");
    f.host.message(f.session, f.worker, final);
    f.host.message(f.session, f.worker, final);
    assert.equal(f.session.entries.length, 1);
    assert.equal(f.session.entries[0].id, "msg_thinking:1");
    assert.equal(f.session.entries[0].text, "先看一下当前的状态。");
    assert.equal(f.worker.raw.size, 0);
  } finally {
    await f.close();
  }
});

test("separately finalized blocks and later messages may legitimately contain identical text", async () => {
  const f = await fixture();
  try {
    stream(f, "msg_blocks", 1, "Repeated on purpose.");
    f.host.message(
      f.session,
      f.worker,
      assistant("msg_blocks", "Repeated on purpose."),
    );
    stream(f, "msg_blocks", 3, "Repeated on purpose.");
    f.host.message(
      f.session,
      f.worker,
      assistant("msg_blocks", "Repeated on purpose."),
    );
    stream(f, "msg_next", 1, "Repeated on purpose.");
    f.host.message(
      f.session,
      f.worker,
      assistant("msg_next", "Repeated on purpose."),
    );
    assert.deepEqual(
      f.session.entries.map((entry) => entry.id),
      ["msg_blocks:1", "msg_blocks:3", "msg_next:1"],
    );
    assert.ok(
      f.session.entries.every((entry) => entry.text === "Repeated on purpose."),
    );
  } finally {
    await f.close();
  }
});

test("final messages without streaming remain distinct and replay safely", async () => {
  const f = await fixture();
  try {
    const first = assistant("msg_no_stream", "First block.");
    const second = assistant("msg_no_stream", "Second block.");
    for (const message of [first, second, first, second])
      f.host.message(f.session, f.worker, message);
    assert.deepEqual(
      f.session.entries.map((entry) => entry.text),
      ["First block.", "Second block."],
    );
  } finally {
    await f.close();
  }
});

test("restore repairs only proven legacy duplicates and keeps an original workspace backup", async () => {
  const f = await fixture();
  const restored = new AgentHost(f.host.dataDir);
  try {
    const values = [
      ["msg_old:1", "same"],
      ["msg_old:0", "same"],
      ["msg_other:0", "same"],
      ["msg_real:0", "repeat"],
      ["msg_real:1", "repeat"],
      ["msg_different:1", "one"],
      ["msg_different:0", "two"],
    ];
    for (const [id, text] of values)
      f.host.add(f.session, "assistant", text, { id });
    f.host.add(f.session, "user", "same");
    await f.host.close();
    await restored.init();
    const entries = restored.get(f.session.id).entries;
    assert.equal(entries.length, 7);
    assert.ok(!entries.some((entry) => entry.id === "msg_old:0"));
    assert.equal(entries.filter((entry) => entry.text === "repeat").length, 2);
    assert.equal(entries.at(-1)?.kind, "user");
    const backup = JSON.parse(
      await fs.readFile(
        path.join(f.host.dataDir, "workspace.before-0.3.2.json"),
        "utf8",
      ),
    );
    assert.equal(backup.sessions[0].entries.length, 8);
    await restored.init();
    assert.equal(restored.get(f.session.id).entries.length, 7);
  } finally {
    await restored.close();
    await f.close();
  }
});

test("stop during initial startup cannot launch a worker or send input afterwards", async () => {
  const f = await fixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    f.host.workers.delete(f.session.id);
    const save = f.host.save.bind(f.host);
    let entered = false;
    f.host.save = async () => {
      if (!entered) {
        entered = true;
        await gate;
      }
      await save();
    };
    const sending = f.host.send(
      f.session.id,
      "never delivered",
      f.session.model,
    );
    const rejected = assert.rejects(sending, /已停止/);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(entered, true);
    await f.host.stop(f.session.id);
    release();
    await rejected;
    assert.equal(f.host.workers.size, 0);
    assert.equal(f.session.phase, "interrupted");
    assert.equal(f.session.entries[0].delivery, "cancelled");
  } finally {
    release();
    await f.close();
  }
});

test("running conversations accept ordered follow-ups and remain busy until all inputs are consumed", async () => {
  const f = await fixture();
  try {
    f.session.phase = "running";
    await Promise.all([
      f.host.send(f.session.id, "first update", f.session.model),
      f.host.send(f.session.id, "second update", f.session.model),
    ]);
    const inputs = f.worker.queue.items;
    assert.deepEqual(
      inputs.map((m) => m.message.content),
      ["first update", "second update"],
    );
    assert.ok(inputs.every((m) => m.origin?.kind === "human" && m.uuid));
    assert.equal(f.host.workers.get(f.session.id), f.worker);
    f.host.message(f.session, f.worker, result([inputs[0].uuid!], 1));
    assert.equal(f.session.phase, "running");
    assert.equal(f.session.entries[0].delivery, "received");
    assert.equal(f.session.entries[1].delivery, "pending");
    f.host.message(f.session, f.worker, result([inputs[1].uuid!]));
    assert.equal(f.session.phase, "idle");
    assert.equal(f.worker.pendingInput.size, 0);
  } finally {
    await f.close();
  }
});

test("follow-ups do not answer approval cards; stop cancels unsent input and blocks already-queued sends", async () => {
  const f = await fixture();
  try {
    f.session.phase = "approval";
    f.session.approvals.push({
      id: randomUUID(),
      tool: "Bash",
      input: { command: "example" },
      time: Date.now(),
    });
    await f.host.send(f.session.id, "additional context", f.session.model);
    assert.equal(f.session.phase, "approval");
    assert.equal(f.session.approvals.length, 1);
    await f.host.setPermissions("manual", f.session.id);
    assert.deepEqual(f.modes, ["default"]);
    assert.equal(f.session.approvals.length, 1);
    const queued = f.host.send(
      f.session.id,
      "do not run after stop",
      f.session.model,
    );
    const rejected = assert.rejects(queued, /已停止/);
    await f.host.stop(f.session.id);
    await rejected;
    assert.equal(f.worker.queue.items.length, 0);
    assert.equal(f.worker.abort.signal.aborted, true);
    assert.equal(f.session.entries[0].delivery, "cancelled");
    assert.equal(f.session.phase, "interrupted");
  } finally {
    await f.close();
  }
});

test("MCP edits persist while working, keep the active server provenance, and apply at idle", async () => {
  const f = await fixture();
  try {
    await f.host.mcp.import({ mcpServers: { local: { command: "node" } } });
    f.worker.mcpRevision = f.host.mcp.revision;
    f.worker.mcpNames = ["local"];
    f.session.phase = "running";
    await f.host.configureMcp(() => f.host.mcp.remove("local"));
    assert.equal(
      f.connections.length,
      0,
      "Active tools must not be disconnected",
    );
    assert.equal(f.host.snapshot().mcpPending, true);
    assert.deepEqual(
      await f.host.preToolUse(
        f.session,
        "mcp__local__echo",
        {},
        new AbortController().signal,
        { name: "local", source: "dynamic" },
      ),
      {},
    );
    f.session.phase = "idle";
    await f.host.syncMcp(f.session, f.worker);
    assert.deepEqual(f.connections, [{}]);
    assert.deepEqual(f.worker.mcpNames, []);
    assert.equal(f.host.snapshot().mcpPending, false);
  } finally {
    await f.close();
  }
});

test("an earlier result arriving during send cannot leave the new input idle", async () => {
  const f = await fixture();
  try {
    f.session.phase = "running";
    const save = f.host.save.bind(f.host);
    let once = true;
    f.host.save = async () => {
      if (once) {
        once = false;
        f.host.message(f.session, f.worker, result([]));
        assert.equal(f.session.phase, "idle");
      }
      await save();
    };
    await f.host.send(
      f.session.id,
      "arrived at turn boundary",
      f.session.model,
    );
    assert.equal(f.session.phase, "running");
    assert.equal(f.worker.pendingInput.size, 1);
  } finally {
    await f.close();
  }
});

test("coalesced input receipts cannot strand older messages beyond the SDK receipt window", async () => {
  const f = await fixture();
  try {
    const ids = Array.from({ length: 70 }, () => randomUUID());
    for (const id of ids) {
      f.host.add(f.session, "user", "queued", { id, delivery: "pending" });
      f.worker.pendingInput.add(id);
    }
    f.host.message(f.session, f.worker, result(ids.slice(-64)));
    assert.equal(f.worker.pendingInput.size, 0);
    assert.ok(
      f.session.entries.every((entry) => entry.delivery === "received"),
    );
  } finally {
    await f.close();
  }
});
