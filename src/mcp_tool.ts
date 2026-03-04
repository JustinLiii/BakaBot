import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type, type TSchema } from "@sinclair/typebox";

type JsonRpcValue = string | number | boolean | null | JsonRpcObject | JsonRpcValue[];
type JsonRpcObject = { [key: string]: JsonRpcValue };

interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: number;
  result: JsonRpcObject;
}

interface JsonRpcError {
  jsonrpc: "2.0";
  id: number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface McpInitializeResult {
  sessionId?: string;
}

interface McpToolCallResult {
  content?: Array<{ type?: string; text?: string }>;
  [key: string]: unknown;
}

interface McpToolsListResult {
  tools?: McpToolInfo[];
}

interface McpToolRegisterOutput {
  registered: string[];
  skipped: string[];
}

interface McpInitializeConfig {
  protocolVersion: string;
  capabilities: JsonRpcObject;
  clientInfo: {
    name: string;
    version: string;
  };
}

interface McpClientOptions {
  initialize?: Partial<McpInitializeConfig>;
  sendInitializedNotification?: boolean;
  headers?: Record<string, string>;
}

function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
}

function buildPrefix(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    const host = sanitizeName(url.host);
    return host.length > 0 ? host : "mcp";
  } catch {
    return "mcp";
  }
}

async function mcpRpc(
  endpoint: string,
  method: string,
  params: JsonRpcObject = {},
  sessionId?: string,
  requestHeaders?: Record<string, string>
): Promise<{ result: JsonRpcObject; sessionId?: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    ...(requestHeaders ?? {}),
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;

  const payload = {
    jsonrpc: "2.0",
    id: Date.now(),
    method,
    params,
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`MCP request failed: ${response.status} ${response.statusText}`);
  }

  const body = await response.json() as JsonRpcResponse;
  const responseSessionId = response.headers.get("mcp-session-id") ?? sessionId;

  if ("error" in body) {
    throw new Error(`MCP ${method} error: ${body.error.message}`);
  }
  return { result: body.result, sessionId: responseSessionId ?? undefined };
}

function getInitializePayload(options?: McpClientOptions): JsonRpcObject {
  return {
    protocolVersion: "2025-03-26",
    capabilities: options?.initialize?.capabilities ?? {},
    clientInfo: {
      name: options?.initialize?.clientInfo?.name ?? "bakabot",
      version: options?.initialize?.clientInfo?.version ?? "1.0.0",
    },
    ...(options?.initialize?.protocolVersion ? { protocolVersion: options.initialize.protocolVersion } : {}),
  };
}

async function initializeMcp(endpoint: string, options?: McpClientOptions): Promise<McpInitializeResult> {
  const initializeResult = await mcpRpc(endpoint, "initialize", getInitializePayload(options), undefined, options?.headers);
  const shouldSendInitialized = options?.sendInitializedNotification ?? true;
  if (!shouldSendInitialized) {
    return { sessionId: initializeResult.sessionId };
  }
  try {
    await mcpRpc(endpoint, "notifications/initialized", {}, initializeResult.sessionId, options?.headers);
  } catch {
    // Some MCP servers don't require or support this notification.
  }
  return { sessionId: initializeResult.sessionId };
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function jsonSchemaToTypeBox(schema: unknown): TSchema {
  const schemaObj = asObject(schema);
  if (!schemaObj) return Type.Object({}, { additionalProperties: true });
  return Type.Unsafe(schemaObj as TSchema);
}

function makeMcpAgentTool(
  endpoint: string,
  prefix: string,
  mcpTool: McpToolInfo,
  initialSessionId?: string,
  options?: McpClientOptions
): AgentTool {
  let sessionId = initialSessionId;
  return {
    name: `mcp_${prefix}_${sanitizeName(mcpTool.name)}`,
    label: `MCP: ${mcpTool.name}`,
    description: mcpTool.description ?? `MCP tool ${mcpTool.name} from ${endpoint}`,
    parameters: jsonSchemaToTypeBox(mcpTool.inputSchema),
    execute: async (_toolCallId, params: any) => {
      const args = (params && typeof params === "object" && !Array.isArray(params) ? params : {}) as JsonRpcObject;
      try {
        const callResult = await mcpRpc(
          endpoint,
          "tools/call",
          {
            name: mcpTool.name,
            arguments: args,
          },
          sessionId,
          options?.headers
        );
        sessionId = callResult.sessionId ?? sessionId;
        const result = callResult.result as unknown as McpToolCallResult;
        const text = (result.content ?? [])
          .filter((c) => c.type === "text" && typeof c.text === "string")
          .map((c) => c.text as string)
          .join("\n")
          .trim();
        return {
          content: [{ type: "text", text: text.length > 0 ? text : JSON.stringify(result, null, 2) }],
          details: {
            endpoint,
            tool: mcpTool.name,
            result,
          },
        };
      } catch {
        const retryInit = await initializeMcp(endpoint, options);
        sessionId = retryInit.sessionId;
        const retryResult = await mcpRpc(
          endpoint,
          "tools/call",
          {
            name: mcpTool.name,
            arguments: args,
          },
          sessionId,
          options?.headers
        );
        sessionId = retryResult.sessionId ?? sessionId;
        const result = retryResult.result as unknown as McpToolCallResult;
        const text = (result.content ?? [])
          .filter((c) => c.type === "text" && typeof c.text === "string")
          .map((c) => c.text as string)
          .join("\n")
          .trim();
        return {
          content: [{ type: "text", text: text.length > 0 ? text : JSON.stringify(result, null, 2) }],
          details: {
            endpoint,
            tool: mcpTool.name,
            result,
          },
        };
      }
    },
  };
}

async function createToolsFromSingleEndpoint(endpoint: string, options?: McpClientOptions): Promise<AgentTool[]> {
  const normalizedEndpoint = endpoint.trim();
  if (!normalizedEndpoint) {
    throw new Error("MCP endpoint cannot be empty");
  }

  const init = await initializeMcp(normalizedEndpoint, options);
  const listed = await mcpRpc(normalizedEndpoint, "tools/list", {}, init.sessionId, options?.headers);
  const listResult = listed.result as unknown as McpToolsListResult;
  const tools = listResult.tools ?? [];
  const prefix = buildPrefix(normalizedEndpoint);
  return tools.map((tool) => makeMcpAgentTool(normalizedEndpoint, prefix, tool, listed.sessionId ?? init.sessionId, options));
}

async function createMcpToolsFromEndpoints(endpoints: string[], options?: McpClientOptions): Promise<AgentTool[]> {
  const allTools = await Promise.all(endpoints.map((endpoint) => createToolsFromSingleEndpoint(endpoint, options)));
  return allTools.flat();
}

export { createMcpToolsFromEndpoints };
export type { McpToolRegisterOutput, McpClientOptions };
