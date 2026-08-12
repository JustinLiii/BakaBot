import { afterEach, describe, expect, mock, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";

import { formatMutationResult, McpManager } from "../src/mcp/manager.ts";

const createdSessions: string[] = [];
const defaultConfigPath = path.resolve(process.cwd(), "mcp.default.json");

function sessionId(): string {
  const id = `mcp-test-${crypto.randomUUID()}`;
  createdSessions.push(id);
  return id;
}

function sessionConfigPath(id: string): string {
  return path.resolve(process.cwd(), "data", "sessions", id, "mcp.json");
}

function installMcpFetch(toolName: string = "echo", failingUrl?: string): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    if (failingUrl && url === failingUrl) throw new Error("fixture connection failed");
    const body = JSON.parse(String(init?.body)) as { id?: number; method: string };
    if (body.id === undefined) return new Response(null, { status: 202 });
    const result = body.method === "initialize"
      ? {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "fixture", version: "1.0.0" },
        }
      : { tools: [{ name: toolName, inputSchema: { type: "object" } }] };
    return Response.json({ jsonrpc: "2.0", id: body.id, result });
  }) as unknown as typeof fetch;
  return (): void => { globalThis.fetch = originalFetch; };
}

async function withDefaultConfig(config: unknown, run: () => Promise<void>): Promise<void> {
  let previous: string | undefined;
  try {
    previous = await fs.readFile(defaultConfigPath, "utf8");
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
  await fs.writeFile(defaultConfigPath, JSON.stringify(config), "utf8");
  try {
    await run();
  } finally {
    if (previous === undefined) {
      await fs.rm(defaultConfigPath, { force: true });
    } else {
      await fs.writeFile(defaultConfigPath, previous, "utf8");
    }
  }
}

afterEach(async () => {
  await Promise.all(createdSessions.splice(0).map((id) =>
    fs.rm(path.dirname(sessionConfigPath(id)), { recursive: true, force: true }),
  ));
});

describe("McpManager", () => {
  test("reports other reload failures after deleting a server", () => {
    expect(formatMutationResult({
      action: "deleted",
      serverName: "removed",
      otherFailedServers: 2,
    })).toBe("已删除 MCP 服务器「removed」。\n另有 2 个 MCP 服务器初始化失败，请使用 /mcp list 查看。");
  });

  test("reports other reload failures when the target server also fails", () => {
    expect(formatMutationResult({
      action: "updated",
      serverName: "target",
      fieldPath: "url",
      targetStatus: {
        state: "error",
        transport: "streamable-http",
        source: "session",
        toolCount: 0,
        error: "target failed",
      },
      otherFailedServers: 1,
    })).toContain("另有 1 个 MCP 服务器初始化失败");
  });

  test("persists a session server and publishes its discovered tools", async () => {
    const restoreFetch = installMcpFetch();
    const id = sessionId();
    let publishedTools: AgentTool[] = [];
    const manager = await McpManager.create({
      sessionId: id,
      reservedToolNames: ["web_fetch"],
      onToolsChanged: (tools): void => { publishedTools = tools; },
    });

    try {
      const result = await manager.addServer("Remote", { url: "https://example.com/mcp" });

      expect(result.targetStatus).toMatchObject({ state: "connected", toolCount: 1 });
      expect(manager.listServers()).toMatchObject([{ name: "Remote", source: "session" }]);
      expect(publishedTools.map((tool) => tool.name)).toEqual(["mcp_remote_echo"]);
      expect(JSON.parse(await fs.readFile(sessionConfigPath(id), "utf8"))).toEqual({
        mcpServers: { Remote: { url: "https://example.com/mcp" } },
      });
    } finally {
      await manager.close();
      restoreFetch();
    }
  });

  test("rejects the whole invalid session file and refuses mutations", async () => {
    const id = sessionId();
    await fs.mkdir(path.dirname(sessionConfigPath(id)), { recursive: true });
    await fs.writeFile(sessionConfigPath(id), JSON.stringify({
      mcpServers: { bad: { command: "npx", unknown: true } },
    }));
    const manager = await McpManager.create({
      sessionId: id,
      reservedToolNames: [],
      onToolsChanged: (): void => undefined,
    });

    try {
      expect(manager.configurationState.state).toBe("session-config-rejected");
      expect(manager.listServers()).toEqual([]);
      await expect(manager.addServer("remote", { url: "https://example.com/mcp" })).rejects.toMatchObject({
        code: "INVALID_CONFIG_FILE",
      });
    } finally {
      await manager.close();
    }
  });

  test("reserves MCP management tool names by default", async () => {
    const restoreFetch = installMcpFetch("list_mcp_servers");
    const manager = await McpManager.create({
      sessionId: sessionId(),
      reservedToolNames: [],
      onToolsChanged: (): void => undefined,
    });

    try {
      const result = await manager.addServer("control", { url: "https://example.com/mcp" });
      expect(result.targetStatus).toMatchObject({
        state: "error",
        error: "tool name conflict: list_mcp_servers",
      });
    } finally {
      await manager.close();
      restoreFetch();
    }
  });

  test("can disable reserved MCP management source names", async () => {
    const restoreFetch = installMcpFetch("list_mcp_servers");
    let publishedTools: AgentTool[] = [];
    const manager = await McpManager.create({
      sessionId: sessionId(),
      reservedToolNames: [],
      reserveMcpManagementToolNames: false,
      onToolsChanged: (tools): void => { publishedTools = tools; },
    });

    try {
      const result = await manager.addServer("control", { url: "https://example.com/mcp" });
      expect(result.targetStatus?.state).toBe("connected");
      expect(publishedTools.map((tool) => tool.name)).toEqual(["mcp_control_list_mcp_servers"]);
    } finally {
      await manager.close();
      restoreFetch();
    }
  });

  test("merges valid default and session configs and keeps defaults read-only", async () => {
    await withDefaultConfig({
      mcpServers: { Default: { url: "https://example.com/default" } },
    }, async () => {
      const restoreFetch = installMcpFetch();
      const id = sessionId();
      await fs.mkdir(path.dirname(sessionConfigPath(id)), { recursive: true });
      await fs.writeFile(sessionConfigPath(id), JSON.stringify({
        mcpServers: { Session: { url: "https://example.com/session" } },
      }));
      const manager = await McpManager.create({
        sessionId: id,
        reservedToolNames: [],
        onToolsChanged: (): void => undefined,
      });

      try {
        expect(manager.listServers()).toMatchObject([
          { name: "Default", source: "default", state: "connected" },
          { name: "Session", source: "session", state: "connected" },
        ]);
        await expect(manager.updateServer("default", {
          operation: "set",
          path: "url",
          value: "https://example.com/other",
        })).rejects.toMatchObject({ code: "READ_ONLY_SERVER" });
        await expect(manager.deleteServer("DEFAULT")).rejects.toMatchObject({ code: "READ_ONLY_SERVER" });
      } finally {
        await manager.close();
        restoreFetch();
      }
    });
  });

  test("falls back to defaults when session names conflict case-insensitively", async () => {
    await withDefaultConfig({
      mcpServers: { Shared: { url: "https://example.com/default" } },
    }, async () => {
      const restoreFetch = installMcpFetch();
      const id = sessionId();
      await fs.mkdir(path.dirname(sessionConfigPath(id)), { recursive: true });
      await fs.writeFile(sessionConfigPath(id), JSON.stringify({
        mcpServers: { shared: { url: "https://example.com/session" } },
      }));
      const manager = await McpManager.create({
        sessionId: id,
        reservedToolNames: [],
        onToolsChanged: (): void => undefined,
      });

      try {
        expect(manager.configurationState.state).toBe("session-config-rejected");
        expect(manager.listServers()).toMatchObject([
          { name: "Shared", source: "default", state: "connected" },
        ]);
      } finally {
        await manager.close();
        restoreFetch();
      }
    });
  });

  test("loads no servers when the default config is invalid", async () => {
    await withDefaultConfig({
      mcpServers: { bad: { command: "bun", unknown: true } },
    }, async () => {
      const manager = await McpManager.create({
        sessionId: sessionId(),
        reservedToolNames: [],
        onToolsChanged: (): void => undefined,
      });

      try {
        expect(manager.configurationState.state).toBe("default-config-invalid");
        expect(manager.listServers()).toEqual([]);
      } finally {
        await manager.close();
      }
    });
  });

  test("isolates dynamic connection failures to the failing server", async () => {
    const brokenUrl = "https://example.com/broken";
    const restoreFetch = installMcpFetch("echo", brokenUrl);
    const id = sessionId();
    await fs.mkdir(path.dirname(sessionConfigPath(id)), { recursive: true });
    await fs.writeFile(sessionConfigPath(id), JSON.stringify({
      mcpServers: {
        healthy: { url: "https://example.com/healthy" },
        broken: { url: brokenUrl },
      },
    }));
    let publishedTools: AgentTool[] = [];
    const manager = await McpManager.create({
      sessionId: id,
      reservedToolNames: [],
      onToolsChanged: (tools): void => { publishedTools = tools; },
    });

    try {
      expect(manager.listServers()).toMatchObject([
        { name: "healthy", state: "connected" },
        { name: "broken", state: "error", error: "fixture connection failed" },
      ]);
      expect(publishedTools.map((tool) => tool.name)).toEqual(["mcp_healthy_echo"]);
    } finally {
      await manager.close();
      restoreFetch();
    }
  });
});
