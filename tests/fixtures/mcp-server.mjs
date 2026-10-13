import readline from "node:readline";

// A local, read-only MCP server used by tests; never sends data off-machine.
for await (const line of readline.createInterface({ input: process.stdin })) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    continue;
  }
  if (message.id === undefined) continue;
  let result;
  if (message.method === "initialize")
    result = {
      protocolVersion: message.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: "zemicc-fixture", version: "1.0.0" },
    };
  else if (message.method === "tools/list")
    result = {
      tools: [
        {
          name: "echo",
          description: "Return a fixture message without side effects.",
          inputSchema: {
            type: "object",
            properties: { message: { type: "string" } },
            required: ["message"],
          },
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            openWorldHint: false,
          },
        },
      ],
    };
  else if (message.method === "tools/call")
    result = {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            message: message.params.arguments.message,
            inheritedClaudeKey: Boolean(process.env.ANTHROPIC_API_KEY),
            ownSecretPresent: Boolean(process.env.FIXTURE_TOKEN),
          }),
        },
      ],
    };
  else result = {};
  process.stdout.write(
    JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\n",
  );
}
