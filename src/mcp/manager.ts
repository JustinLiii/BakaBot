import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";

import { connectMcpServer, sanitizeToolName } from "./client.ts";
import {
  mergeMcpConfigs,
  parseMcpConfig,
  setConfigField,
  unsetConfigField,
} from "./config.ts";
import type { JsonValue, McpConfig, McpServerConfig } from "./config.ts";
import type { McpServerRuntime } from "./client.ts";

const MANAGEMENT_TOOL_NAMES = [
  "list_mcp_servers",
  "get_mcp_server",
  "add_mcp_server",
  "update_mcp_server",
  "delete_mcp_server",
];

type McpTransport = "stdio" | "streamable-http";
type McpServerSource = "default" | "session";

interface McpServerStatus {
  state: "connected" | "error";
  transport: McpTransport;
  source: McpServerSource;
  toolCount: number;
  error?: string;
}

interface McpServerSummary extends McpServerStatus {
  name: string;
}

interface McpServerView {
  name: string;
  config: McpServerConfig;
  status: McpServerStatus;
}

interface McpMutationResult {
  action: "added" | "updated" | "deleted";
  serverName: string;
  fieldPath?: string;
  targetStatus?: McpServerStatus;
  otherFailedServers: number;
}

type McpManagerErrorCode =
  | "INVALID_CONFIG_FILE"
  | "INVALID_SERVER_NAME"
  | "SERVER_NOT_FOUND"
  | "SERVER_ALREADY_EXISTS"
  | "READ_ONLY_SERVER"
  | "INVALID_FIELD_PATH"
  | "INVALID_SERVER_CONFIG"
  | "PERSISTENCE_FAILED";

class McpManagerError extends Error {
  constructor(public readonly code: McpManagerErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "McpManagerError";
  }
}

interface McpManagerOptions {
  sessionId: string;
  reservedToolNames: string[];
  reserveMcpManagementToolNames?: boolean;
  onToolsChanged: (tools: AgentTool[]) => void;
}

interface RuntimeEntry {
  config: McpServerConfig;
  source: McpServerSource;
  runtime?: McpServerRuntime;
  status: McpServerStatus;
}

function transportOf(config: McpServerConfig): McpTransport {
  return "command" in config ? "stdio" : "streamable-http";
}

function normalizeName(name: string): string {
  return name.toLowerCase();
}

function assertServerName(name: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new McpManagerError("INVALID_SERVER_NAME", `MCP server '${name}' has an invalid name`);
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatServerStatus(name: string, status: McpServerStatus): string {
  const source = status.source === "default" ? "默认" : "会话";
  if (status.state === "connected") {
    return `${name} [${source}][${status.transport}] 已连接，${status.toolCount} 个工具`;
  }
  return `${name} [${source}][${status.transport}] 初始化失败：${status.error ?? "未知错误"}`;
}

function formatListResult(manager: McpManager): string {
  const state = manager.configurationState;
  if (state.state === "default-config-invalid") {
    return `当前会话没有已加载的 MCP 服务器。\n默认配置格式错误，已跳过整个 mcp.json；详情请查看控制台日志。`;
  }
  if (state.state === "session-config-rejected") {
    const entries = manager.listServers();
    const lines = entries.map((server) => `- ${formatServerStatus(server.name, server)}`);
    return `当前会话配置格式错误，已回退到默认 MCP 配置。\n${lines.length > 0 ? `当前加载的 MCP 服务器：\n${lines.join("\n")}` : "当前没有可加载的默认 MCP 服务器。"}`;
  }
  const entries = manager.listServers();
  if (entries.length === 0) return "当前会话没有配置 MCP 服务器。";
  return `当前会话的 MCP 服务器：\n${entries.map((server) => `- ${formatServerStatus(server.name, server)}`).join("\n")}`;
}

function formatMutationResult(result: McpMutationResult): string {
  const other = result.otherFailedServers > 0
    ? `\n另有 ${result.otherFailedServers} 个 MCP 服务器初始化失败，请使用 /mcp list 查看。`
    : "";
  if (result.action === "deleted") return `已删除 MCP 服务器「${result.serverName}」。${other}`;
  const action = result.action === "added" ? "添加" : "更新";
  const field = result.fieldPath ? `的配置项「${result.fieldPath}」` : "";
  if (result.targetStatus?.state === "error") {
    return `已保存 MCP 服务器「${result.serverName}」${field}的配置，但初始化失败，未注册相关工具。\n原因：${result.targetStatus.error ?? "未知错误"}${other}`;
  }
  const count = result.targetStatus?.toolCount ?? 0;
  return `已${action} MCP 服务器「${result.serverName}」${field}，并成功加载 ${count} 个工具。${other}`;
}

function formatServerView(view: McpServerView): string {
  return `MCP 服务器「${view.name}」的配置：\n${JSON.stringify(view.config, null, 2)}`;
}

function formatManagerError(error: unknown): string {
  if (!(error instanceof McpManagerError)) {
    return `MCP 操作失败：${errorText(error)}`;
  }
  const messages: Record<McpManagerErrorCode, string> = {
    INVALID_CONFIG_FILE: "MCP 配置文件格式错误，无法读取或修改。请检查服务器上的 mcp.json。",
    INVALID_SERVER_NAME: "服务器名称只允许英文字母、数字、下划线和连字符。",
    SERVER_NOT_FOUND: "未找到指定的 MCP 服务器。",
    SERVER_ALREADY_EXISTS: "同名 MCP 服务器已存在。",
    READ_ONLY_SERVER: "默认 MCP 服务器为只读配置，无法修改或删除。",
    INVALID_FIELD_PATH: `配置项路径无效：${error.message}`,
    INVALID_SERVER_CONFIG: `MCP 服务器配置格式错误：${error.message}`,
    PERSISTENCE_FAILED: `保存 MCP 配置失败：${error.message}`,
  };
  return messages[error.code];
}

class McpManager {
  readonly configurationState: { state: "loaded" | "session-config-rejected" | "default-config-invalid"; error?: string } = { state: "loaded" };
  private readonly options: McpManagerOptions;
  private readonly defaultConfigPath: string;
  private readonly sessionConfigPath: string;
  private readonly reservedToolNames: Set<string>;
  private readonly reserveMcpManagementToolNames: boolean;
  private sessionConfig: McpConfig = { mcpServers: {} };
  private defaultConfig: McpConfig = { mcpServers: {} };
  private runtimes = new Map<string, RuntimeEntry>();
  private operationQueue: Promise<void> = Promise.resolve();

  private constructor(options: McpManagerOptions) {
    this.options = options;
    this.defaultConfigPath = path.resolve(process.cwd(), "mcp.default.json");
    this.sessionConfigPath = path.resolve(process.cwd(), "data", "sessions", options.sessionId, "mcp.json");
    this.reservedToolNames = new Set(options.reservedToolNames);
    this.reserveMcpManagementToolNames = options.reserveMcpManagementToolNames ?? true;
  }

  static async create(options: McpManagerOptions): Promise<McpManager> {
    const manager = new McpManager({ ...options, reservedToolNames: [...options.reservedToolNames] });
    await manager.reload();
    return manager;
  }

  listServers(): McpServerSummary[] {
    return [...this.runtimes.entries()].map(([name, entry]) => ({ name, ...entry.status }));
  }

  getServer(name: string): McpServerView | null {
    const actualName = this.findName(name);
    if (!actualName) return null;
    const entry = this.runtimes.get(actualName)!;
    return { name: actualName, config: structuredClone(entry.config), status: { ...entry.status } };
  }

  async addServer(name: string, config: McpServerConfig): Promise<McpMutationResult> {
    return this.enqueue(async () => {
      assertServerName(name);
      this.assertSessionWritable();
      if (this.findConfigName(name)) throw new McpManagerError("SERVER_ALREADY_EXISTS", `MCP server '${name}' already exists`);
      let next: McpServerConfig;
      try {
        next = parseMcpConfig(JSON.stringify({ mcpServers: { [name]: config } })).mcpServers[name]!;
      } catch (error) {
        throw new McpManagerError("INVALID_SERVER_CONFIG", errorText(error), error);
      }
      const nextSessionConfig = { mcpServers: { ...this.sessionConfig.mcpServers, [name]: next } };
      await this.persistSessionConfig(nextSessionConfig);
      await this.reload();
      return this.mutation("added", name);
    });
  }

  async updateServer(name: string, change: { operation: "set"; path: string; value: JsonValue } | { operation: "unset"; path: string }): Promise<McpMutationResult> {
    return this.enqueue(async () => {
      this.assertSessionWritable();
      const actualName = this.findConfigName(name);
      if (!actualName) throw new McpManagerError("SERVER_NOT_FOUND", `MCP server '${name}' was not found`);
      if (this.defaultConfig.mcpServers[actualName]) throw new McpManagerError("READ_ONLY_SERVER", `MCP server '${actualName}' is read-only`);
      const current = this.sessionConfig.mcpServers[actualName]! as unknown as Record<string, unknown>;
      let updated: Record<string, unknown>;
      try {
        updated = change.operation === "set"
          ? setConfigField(current, change.path, change.value)
          : unsetConfigField(current, change.path);
      } catch (error) {
        throw new McpManagerError("INVALID_FIELD_PATH", errorText(error), error);
      }
      let parsed: McpServerConfig;
      try {
        parsed = parseMcpConfig(JSON.stringify({ mcpServers: { [actualName]: updated } })).mcpServers[actualName]!;
      } catch (error) {
        throw new McpManagerError("INVALID_SERVER_CONFIG", errorText(error), error);
      }
      const nextSessionConfig = { mcpServers: { ...this.sessionConfig.mcpServers, [actualName]: parsed } };
      await this.persistSessionConfig(nextSessionConfig);
      await this.reload();
      return this.mutation("updated", actualName, change.path);
    });
  }

  async deleteServer(name: string): Promise<McpMutationResult> {
    return this.enqueue(async () => {
      this.assertSessionWritable();
      const actualName = this.findConfigName(name);
      if (!actualName) throw new McpManagerError("SERVER_NOT_FOUND", `MCP server '${name}' was not found`);
      if (this.defaultConfig.mcpServers[actualName]) throw new McpManagerError("READ_ONLY_SERVER", `MCP server '${actualName}' is read-only`);
      const { [actualName]: _removed, ...remaining } = this.sessionConfig.mcpServers;
      await this.persistSessionConfig({ mcpServers: remaining });
      await this.reload();
      return this.mutation("deleted", actualName);
    });
  }

  async close(): Promise<void> {
    await Promise.all([...this.runtimes.values()].map((entry) => entry.runtime?.close()));
    this.runtimes.clear();
    this.options.onToolsChanged([]);
  }

  private async reload(): Promise<void> {
    await this.replaceRuntimes(new Map());
    const defaults = await this.readConfigFile(this.defaultConfigPath, true);
    this.defaultConfig = defaults.config;
    if (!defaults.valid) {
      this.configurationState.state = "default-config-invalid";
      this.configurationState.error = defaults.error;
      console.warn(`[MCP] Invalid default config: ${defaults.error}`);
      return;
    }

    const session = await this.readConfigFile(this.sessionConfigPath, false);
    this.sessionConfig = session.config;
    let merged: McpConfig;
    if (!session.valid) {
      this.configurationState.state = "session-config-rejected";
      this.configurationState.error = session.error;
      merged = this.defaultConfig;
      console.warn(`[MCP] Invalid session config: ${session.error}`);
    } else {
      try {
        merged = mergeMcpConfigs(this.defaultConfig, this.sessionConfig);
        this.configurationState.state = "loaded";
        delete this.configurationState.error;
      } catch (error) {
        this.configurationState.state = "session-config-rejected";
        this.configurationState.error = errorText(error);
        merged = this.defaultConfig;
        console.warn(`[MCP] Invalid merged config: ${this.configurationState.error}`);
      }
    }

    const next = await this.connectEntries(merged);
    await this.replaceRuntimes(next);
  }

  private async connectEntries(config: McpConfig): Promise<Map<string, RuntimeEntry>> {
    const entries = Object.entries(config.mcpServers);
    const connected = await Promise.all(entries.map(async ([name, serverConfig]): Promise<[string, RuntimeEntry]> => {
      const source: McpServerSource = this.defaultConfig.mcpServers[name] ? "default" : "session";
      const baseStatus = { transport: transportOf(serverConfig), source, toolCount: 0 } as const;
      try {
        const runtime = await connectMcpServer(name, serverConfig);
        return [name, { config: serverConfig, source, runtime, status: { ...baseStatus, state: "connected", toolCount: runtime.tools.length } }];
      } catch (error) {
        console.warn(`[MCP] Server ${name} failed to initialize:`, error);
        return [name, { config: serverConfig, source, status: { ...baseStatus, state: "error", error: errorText(error) } }];
      }
    }));
    const next = new Map<string, RuntimeEntry>(connected);

    const owners = new Map<string, string[]>();
    for (const [name, entry] of next) {
      if (entry.status.state !== "connected" || !entry.runtime) continue;
      for (const tool of entry.runtime.tools) {
        const names = owners.get(tool.name) ?? [];
        names.push(name);
        owners.set(tool.name, names);
      }
    }
    const conflicts = new Map<string, string>();
    if (this.reserveMcpManagementToolNames) {
      for (const [name, entry] of next) {
        const conflict = entry.runtime?.sourceToolNames.find((toolName) => MANAGEMENT_TOOL_NAMES.includes(toolName));
        if (conflict) conflicts.set(name, conflict);
      }
    }
    for (const [toolName, serverNames] of owners) {
      if (this.reservedToolNames.has(toolName) || serverNames.length > 1) {
        for (const serverName of serverNames) conflicts.set(serverName, toolName);
      }
    }
    for (const [name, conflict] of conflicts) {
      const entry = next.get(name)!;
      if (entry.runtime) {
        await this.closeRuntime(name, entry.runtime);
        entry.runtime = undefined;
        entry.status = { ...entry.status, state: "error", error: `tool name conflict: ${conflict}`, toolCount: 0 };
      }
    }
    return next;
  }

  private async replaceRuntimes(next: Map<string, RuntimeEntry>): Promise<void> {
    const old = this.runtimes;
    this.runtimes = next;
    await Promise.all([...old.entries()].map(([name, entry]) => this.closeRuntime(name, entry.runtime)));
    this.options.onToolsChanged([...next.values()].flatMap((entry) => entry.runtime?.tools ?? []));
  }

  private async closeRuntime(name: string, runtime?: McpServerRuntime): Promise<void> {
    if (!runtime) return;
    try {
      await runtime.close();
    } catch (error) {
      console.warn(`[MCP] Server ${name} failed to close:`, error);
    }
  }

  private async readConfigFile(filePath: string, _defaultFile: boolean): Promise<{ config: McpConfig; valid: boolean; error?: string }> {
    try {
      const content = await fs.readFile(filePath, "utf8");
      return { config: parseMcpConfig(content), valid: true };
    } catch (error: any) {
      if (error?.code === "ENOENT") return { config: { mcpServers: {} }, valid: true };
      return { config: { mcpServers: {} }, valid: false, error: errorText(error) };
    }
  }

  private async persistSessionConfig(config: McpConfig): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.sessionConfigPath), { recursive: true });
      await fs.writeFile(this.sessionConfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    } catch (error) {
      throw new McpManagerError("PERSISTENCE_FAILED", `failed to persist MCP config: ${errorText(error)}`, error);
    }
  }

  private findName(name: string): string | undefined {
    return [...this.runtimes.keys()].find((candidate) => normalizeName(candidate) === normalizeName(name));
  }

  private findConfigName(name: string): string | undefined {
    return [...Object.keys(this.defaultConfig.mcpServers), ...Object.keys(this.sessionConfig.mcpServers)]
      .find((candidate) => normalizeName(candidate) === normalizeName(name));
  }

  private assertSessionWritable(): void {
    if (this.configurationState.state === "session-config-rejected") {
      throw new McpManagerError("INVALID_CONFIG_FILE", "session MCP config is invalid and cannot be modified");
    }
    if (this.configurationState.state === "default-config-invalid") {
      throw new McpManagerError("INVALID_CONFIG_FILE", "default MCP config is invalid and cannot be modified");
    }
  }

  private mutation(action: McpMutationResult["action"], serverName: string, fieldPath?: string): McpMutationResult {
    const targetStatus = this.runtimes.get(serverName)?.status;
    const otherFailedServers = this.listServers().filter((server) => server.state === "error" && server.name !== serverName).length;
    return { action, serverName, fieldPath, targetStatus, otherFailedServers };
  }

  private async enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.operationQueue;
    let release!: () => void;
    this.operationQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

export {
  formatListResult,
  formatManagerError,
  formatMutationResult,
  formatServerView,
  McpManager,
  MANAGEMENT_TOOL_NAMES,
  McpManagerError,
};
export type { McpManagerOptions, McpManagerErrorCode, McpMutationResult, McpServerStatus, McpServerSummary, McpServerView };
