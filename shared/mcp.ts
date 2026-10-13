export type McpTransport = "stdio" | "http" | "sse";
export type McpDefinition = {
  name: string;
  type: McpTransport;
  enabled: boolean;
  command?: string;
  args?: string[];
  url?: string;
  envKeys: string[];
  headerKeys: string[];
};
export type McpView = McpDefinition & {
  status:
    | "unchecked"
    | "ready"
    | "failed"
    | "needs-auth"
    | "needs-secrets"
    | "disabled";
  missing: string[];
  tools: { name: string; description?: string }[];
  error?: string;
};
export type McpState = { servers: McpView[]; pending: boolean };
