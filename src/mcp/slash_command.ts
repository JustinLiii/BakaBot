import type { JsonValue, McpServerConfig } from "./config.ts";
import {
  formatListResult,
  formatManagerError,
  formatMutationResult,
  formatServerView,
  McpManager,
} from "./manager.ts";

const MCP_HELP = `MCP 命令：
/mcp add <服务器名称> <JSON 配置>
/mcp list
/mcp conf <服务器名称>
/mcp conf <服务器名称> set <配置项> <JSON 值>
/mcp conf <服务器名称> unset <配置项>
/mcp delete <服务器名称>`;

async function handleMcpSlashCommand(rawMessage: string, manager: McpManager): Promise<string | null> {
  const message = rawMessage.trim();
  if (message !== "/mcp" && !message.startsWith("/mcp ")) return null;
  if (message === "/mcp") return MCP_HELP;

  try {
    if (message === "/mcp list") return formatListResult(manager);

    const add = message.match(/^\/mcp add\s+(\S+)\s+([\s\S]+)$/);
    if (add) {
      const config = JSON.parse(add[2]!) as McpServerConfig;
      return formatMutationResult(await manager.addServer(add[1]!, config));
    }

    const remove = message.match(/^\/mcp delete\s+(\S+)$/);
    if (remove) return formatMutationResult(await manager.deleteServer(remove[1]!));

    const set = message.match(/^\/mcp conf\s+(\S+)\s+set\s+(\S+)\s+([\s\S]+)$/);
    if (set) {
      const value = JSON.parse(set[3]!) as JsonValue;
      return formatMutationResult(await manager.updateServer(set[1]!, {
        operation: "set",
        path: set[2]!,
        value,
      }));
    }

    const unset = message.match(/^\/mcp conf\s+(\S+)\s+unset\s+(\S+)$/);
    if (unset) {
      return formatMutationResult(await manager.updateServer(unset[1]!, {
        operation: "unset",
        path: unset[2]!,
      }));
    }

    const get = message.match(/^\/mcp conf\s+(\S+)$/);
    if (get) {
      const view = manager.getServer(get[1]!);
      return view ? formatServerView(view) : "未找到指定的 MCP 服务器。";
    }
    return `命令格式错误。\n${MCP_HELP}`;
  } catch (error) {
    if (error instanceof SyntaxError) return "配置值不是合法的 JSON。";
    return formatManagerError(error);
  }
}

export { handleMcpSlashCommand, MCP_HELP };
