import { describe, expect, mock, test } from "bun:test";

import { connectMcpServer } from "../src/mcp/client.ts";

describe("connectMcpServer", () => {
  test("connects through the SDK and adapts listed tools", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (_input: unknown, init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body)) as {
        id?: number;
        method: string;
        params?: { arguments?: Record<string, unknown> };
      };
      if (body.id === undefined) {
        return new Response(null, { status: 202 });
      }

      let result: unknown;
      if (body.method === "initialize") {
        result = {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "fixture", version: "1.0.0" },
        };
      } else if (body.method === "tools/list") {
        result = {
          tools: [{
            name: "echo-message",
            description: "Echo a message",
            inputSchema: {
              type: "object",
              properties: { message: { type: "string" } },
              required: ["message"],
            },
          }],
        };
      } else if (body.method === "tools/call") {
        result = {
          content: [{ type: "text", text: `echo:${body.params?.arguments?.message}` }],
        };
      } else {
        throw new Error(`Unexpected MCP method: ${body.method}`);
      }

      return Response.json({ jsonrpc: "2.0", id: body.id, result });
    }) as unknown as typeof fetch;

    try {
      const runtime = await connectMcpServer("remoteFixture", {
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer test-token" },
      });
      const tools = runtime.tools;

      expect(tools).toHaveLength(1);
      expect(tools[0]?.name).toBe("mcp_remotefixture_echo_message");
      const result = await tools[0]!.execute("call-1", { message: "hello" });
      expect(result.content).toEqual([{ type: "text", text: "echo:hello" }]);
      expect(result.details).toMatchObject({ server: "remoteFixture", tool: "echo-message" });
      await runtime.close();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
