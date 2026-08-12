import type { AgentTool } from "@mariozechner/pi-agent-core";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

interface McpStdioServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

interface McpHttpServerConfig {
  url: string;
  headers?: Record<string, string>;
}

type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;

interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function assertStringRecord(value: unknown, field: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value) || Object.values(value).some((item) => typeof item !== "string")) {
    throw new Error(`${field} must be an object containing only string values`);
  }
  return value as Record<string, string>;
}

function assertStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${field} must be an array of strings`);
  }
  return value;
}

function assertAllowedFields(serverName: string, server: Record<string, unknown>, fields: string[]): void {
  const unknown = Object.keys(server).find((field) => !fields.includes(field));
  if (unknown) throw new Error(`MCP server '${serverName}' has unknown field '${unknown}'`);
}

function parseServerConfig(serverName: string, value: unknown): McpServerConfig {
  if (!isObject(value)) throw new Error(`MCP server '${serverName}' must be an object`);
  const hasCommand = value.command !== undefined;
  const hasUrl = value.url !== undefined;
  if (hasCommand === hasUrl) {
    throw new Error(`MCP server '${serverName}' must configure exactly one of 'command' or 'url'`);
  }

  if (hasCommand) {
    assertAllowedFields(serverName, value, ["command", "args", "env", "cwd"]);
    if (typeof value.command !== "string" || value.command.trim() === "") {
      throw new Error(`MCP server '${serverName}'.command must be a non-empty string`);
    }
    if (value.cwd !== undefined && (typeof value.cwd !== "string" || value.cwd.trim() === "")) {
      throw new Error(`MCP server '${serverName}'.cwd must be a non-empty string`);
    }
    return {
      command: value.command,
      args: assertStringArray(value.args, `MCP server '${serverName}'.args`),
      env: assertStringRecord(value.env, `MCP server '${serverName}'.env`),
      cwd: value.cwd as string | undefined,
    };
  }

  assertAllowedFields(serverName, value, ["url", "headers"]);
  if (typeof value.url !== "string" || value.url.trim() === "") {
    throw new Error(`MCP server '${serverName}'.url must be a non-empty string`);
  }
  let url: URL;
  try {
    url = new URL(value.url);
  } catch {
    throw new Error(`MCP server '${serverName}'.url must be a valid URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`MCP server '${serverName}'.url must use http or https`);
  }
  return {
    url: value.url,
    headers: assertStringRecord(value.headers, `MCP server '${serverName}'.headers`),
  };
}

function parseMcpConfig(configString: string): McpConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(configString);
  } catch (error) {
    throw new Error(`MCP config must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isObject(parsed) || !isObject(parsed.mcpServers)) {
    throw new Error("MCP config must contain an 'mcpServers' object");
  }
  const unknownTopLevelField = Object.keys(parsed).find((field) => field !== "mcpServers");
  if (unknownTopLevelField) throw new Error(`MCP config has unknown field '${unknownTopLevelField}'`);

  const names = new Map<string, string>();
  const servers: Record<string, McpServerConfig> = Object.create(null) as Record<string, McpServerConfig>;
  for (const [name, value] of Object.entries(parsed.mcpServers)) {
    const key = name.toLowerCase();
    const duplicate = names.get(key);
    if (duplicate) throw new Error(`MCP config duplicates server name '${duplicate}'`);
    names.set(key, name);
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      throw new Error(`MCP server '${name}' has an invalid name`);
    }
    if (UNSAFE_OBJECT_KEYS.has(name.toLowerCase())) {
      throw new Error(`MCP server '${name}' has an unsafe name`);
    }
    servers[name] = parseServerConfig(name, value);
  }
  return { mcpServers: servers };
}

function mergeMcpConfigs(defaults: McpConfig, session: McpConfig): McpConfig {
  const names = new Map<string, string>();
  const servers: Record<string, McpServerConfig> = Object.create(null) as Record<string, McpServerConfig>;
  for (const [name, config] of Object.entries(defaults.mcpServers)) {
    names.set(name.toLowerCase(), name);
    servers[name] = config;
  }
  for (const [name, config] of Object.entries(session.mcpServers)) {
    const conflict = names.get(name.toLowerCase());
    if (conflict) throw new Error(`MCP server '${name}' conflicts with default server '${conflict}'`);
    names.set(name.toLowerCase(), name);
    servers[name] = config;
  }
  return { mcpServers: servers };
}

function cloneJson<T extends JsonValue>(value: T): T {
  return structuredClone(value);
}

function configPathParts(path: string): string[] {
  const parts = path.split(".");
  if (parts.some((part) => part.length === 0)) throw new Error("configuration path cannot contain empty segments");
  if (parts.some((part) => /^\d+$/.test(part))) throw new Error("array indexes are not supported");
  if (parts.some((part) => UNSAFE_OBJECT_KEYS.has(part.toLowerCase()))) {
    throw new Error("configuration path contains an unsafe object key");
  }
  return parts;
}

function setConfigField(server: Record<string, unknown>, path: string, value: JsonValue): Record<string, unknown> {
  const result = structuredClone(server) as Record<string, unknown>;
  const parts = configPathParts(path);
  let current = result;
  for (const part of parts.slice(0, -1)) {
    if (!Object.hasOwn(current, part)) current[part] = {};
    if (!isObject(current[part])) throw new Error(`configuration path '${path}' traverses a non-object value`);
    current = current[part];
  }
  current[parts[parts.length - 1]!] = cloneJson(value);
  return result;
}

function unsetConfigField(server: Record<string, unknown>, path: string): Record<string, unknown> {
  const result = structuredClone(server) as Record<string, unknown>;
  const parts = configPathParts(path);
  let current = result;
  for (const part of parts.slice(0, -1)) {
    if (!Object.hasOwn(current, part) || !isObject(current[part])) throw new Error(`configuration path '${path}' was not found`);
    current = current[part];
  }
  const leaf = parts[parts.length - 1]!;
  if (!Object.hasOwn(current, leaf)) throw new Error(`configuration path '${path}' was not found`);
  delete current[leaf];
  return result;
}

export { mergeMcpConfigs, parseMcpConfig, setConfigField, unsetConfigField };
export type { JsonValue, McpConfig, McpHttpServerConfig, McpServerConfig, McpStdioServerConfig };
