import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { CallToolResult, Tool, Transport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type, type TSchema } from "@sinclair/typebox";

import type { McpServerConfig } from "./config.ts";

interface McpToolDetails {
  server: string;
  tool: string;
  result: CallToolResult;
}

interface McpServerRuntime {
  tools: AgentTool[];
  sourceToolNames: string[];
  close: () => Promise<void>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sanitizeToolName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function createTransport(config: McpServerConfig): Transport {
  if ("command" in config) {
    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env,
      cwd: config.cwd,
    });
  }
  return new StreamableHTTPClientTransport(new URL(config.url), config.headers
    ? { requestInit: { headers: config.headers } }
    : undefined);
}

function jsonSchemaToTypeBox(schema: unknown): TSchema {
  return isObject(schema)
    ? Type.Unsafe(schema as TSchema)
    : Type.Object({}, { additionalProperties: true });
}

function stringifyToolResult(result: CallToolResult): string {
  const text = result.content
    .filter((content) => content.type === "text")
    .map((content) => content.text)
    .join("\n")
    .trim();
  return text || JSON.stringify(result, null, 2);
}

function createAgentTool(serverName: string, client: Client, tool: Tool): AgentTool {
  return {
    name: `mcp_${sanitizeToolName(serverName) || "server"}_${sanitizeToolName(tool.name) || "tool"}`,
    label: `MCP: ${tool.name}`,
    description: tool.description ?? `MCP tool ${tool.name} from ${serverName}`,
    parameters: jsonSchemaToTypeBox(tool.inputSchema),
    execute: async (_toolCallId, params, signal): Promise<AgentToolResult<McpToolDetails>> => {
      const result = await client.callTool(
        { name: tool.name, arguments: isObject(params) ? params : {} },
        signal ? { signal } : undefined,
      );
      return {
        content: [{ type: "text", text: stringifyToolResult(result) }],
        details: { server: serverName, tool: tool.name, result },
      };
    },
  };
}

async function connectMcpServer(serverName: string, config: McpServerConfig): Promise<McpServerRuntime> {
  const client = new Client({ name: "bakabot", version: "1.0.0" });
  try {
    await client.connect(createTransport(config));
    const { tools } = await client.listTools();
    return {
      tools: tools.map((tool) => createAgentTool(serverName, client, tool)),
      sourceToolNames: tools.map((tool) => tool.name),
      close: async (): Promise<void> => client.close(),
    };
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
}

export { connectMcpServer, sanitizeToolName };
export type { McpServerRuntime, McpToolDetails };
