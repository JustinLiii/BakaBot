import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

import {
  formatListResult,
  formatManagerError,
  formatMutationResult,
  formatServerView,
  McpManager,
} from "../mcp/manager.ts";
import type { JsonValue, McpServerConfig } from "../mcp/config.ts";

function textResult(text: string, details: unknown = {}): AgentToolResult<unknown> {
  return { content: [{ type: "text", text }], details };
}

function createMcpManagementTools(manager: McpManager): AgentTool[] {
  const listTool: AgentTool = {
    name: "list_mcp_servers",
    label: "List MCP Servers",
    description: "列出当前会话的默认和会话 MCP 服务器及其连接状态",
    parameters: Type.Object({}),
    execute: async (): Promise<AgentToolResult<unknown>> => textResult(formatListResult(manager), manager.listServers()),
  };

  const getTool: AgentTool = {
    name: "get_mcp_server",
    label: "Get MCP Server",
    description: "查看当前会话中一个 MCP 服务器的完整配置",
    parameters: Type.Object({ name: Type.String({ description: "MCP 服务器名称" }) }),
    execute: async (_id, params): Promise<AgentToolResult<unknown>> => {
      const input = params as { name: string };
      const view = manager.getServer(input.name);
      return view
        ? textResult(formatServerView(view), view)
        : textResult("未找到指定的 MCP 服务器。", { name: input.name });
    },
  };

  const addTool: AgentTool = {
    name: "add_mcp_server",
    label: "Add MCP Server",
    description: "为当前会话添加并加载一个 MCP 服务器（MCP修改需要在下一轮对话（用户发出下一消息）才能生效）",
    parameters: Type.Object({
      name: Type.String({ description: "MCP 服务器名称" }),
      config: Type.Union([
        Type.Object({
          command: Type.String(),
          args: Type.Optional(Type.Array(Type.String())),
          env: Type.Optional(Type.Record(Type.String(), Type.String())),
          cwd: Type.Optional(Type.String()),
        }, { additionalProperties: false }),
        Type.Object({
          url: Type.String(),
          headers: Type.Optional(Type.Record(Type.String(), Type.String())),
        }, { additionalProperties: false }),
      ]),
    }),
    execute: async (_id, params): Promise<AgentToolResult<unknown>> => {
      const input = params as { name: string; config: McpServerConfig };
      try {
        const result = await manager.addServer(input.name, input.config);
        return textResult(formatMutationResult(result), result);
      } catch (error) {
        return textResult(formatManagerError(error), { error: String(error) });
      }
    },
  };

  const updateTool: AgentTool = {
    name: "update_mcp_server",
    label: "Update MCP Server",
    description: "设置或删除当前会话 MCP 服务器的一个对象配置项；数组必须整体设置（MCP修改需要在下一轮对话（用户发出下一消息）才能生效）",
    parameters: Type.Object({
      name: Type.String({ description: "MCP 服务器名称" }),
      operation: Type.Union([Type.Literal("set"), Type.Literal("unset")]),
      path: Type.String({ description: "点分隔的对象字段路径" }),
      value: Type.Optional(Type.Any({ description: "set 操作的新 JSON 值" })),
    }),
    execute: async (_id, params): Promise<AgentToolResult<unknown>> => {
      const input = params as { name: string; operation: "set" | "unset"; path: string; value?: JsonValue };
      if (input.operation === "set" && input.value === undefined) {
        return textResult("set 操作缺少 value。", {});
      }
      try {
        const change = input.operation === "set"
          ? { operation: "set" as const, path: input.path, value: input.value! }
          : { operation: "unset" as const, path: input.path };
        const result = await manager.updateServer(input.name, change);
        return textResult(formatMutationResult(result), result);
      } catch (error) {
        return textResult(formatManagerError(error), { error: String(error) });
      }
    },
  };

  const deleteTool: AgentTool = {
    name: "delete_mcp_server",
    label: "Delete MCP Server",
    description: "删除当前会话的一个 MCP 服务器；默认服务器不能删除（MCP修改需要在下一轮对话（用户发出下一消息）才能生效）",
    parameters: Type.Object({ name: Type.String({ description: "MCP 服务器名称" }) }),
    execute: async (_id, params): Promise<AgentToolResult<unknown>> => {
      const input = params as { name: string };
      try {
        const result = await manager.deleteServer(input.name);
        return textResult(formatMutationResult(result), result);
      } catch (error) {
        return textResult(formatManagerError(error), { error: String(error) });
      }
    },
  };

  return [listTool, getTool, addTool, updateTool, deleteTool];
}

export { createMcpManagementTools };
