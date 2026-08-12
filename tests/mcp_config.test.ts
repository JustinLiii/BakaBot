import { describe, expect, test } from "bun:test";

import {
  mergeMcpConfigs,
  parseMcpConfig,
  setConfigField,
  unsetConfigField,
} from "../src/mcp/config.ts";

describe("MCP config", () => {
  test("strictly parses stdio and Streamable HTTP servers", () => {
    const config = parseMcpConfig(JSON.stringify({
      mcpServers: {
        filesystem: { command: "npx", args: ["-y", "package"] },
        remote: { url: "https://example.com/mcp", headers: { Authorization: "Bearer token" } },
      },
    }));

    expect(Object.keys(config.mcpServers)).toEqual(["filesystem", "remote"]);
    expect(() => parseMcpConfig(JSON.stringify({
      mcpServers: { bad: { command: "npx", unknown: true } },
    }))).toThrow("unknown field 'unknown'");
  });

  test("rejects server names that collide case-insensitively", () => {
    expect(() => parseMcpConfig(JSON.stringify({
      mcpServers: {
        GitHub: { url: "https://example.com/mcp" },
        github: { command: "npx" },
      },
    }))).toThrow("duplicates server name 'GitHub'");
  });

  test("merges default and session configs without implicit overrides", () => {
    const defaults = parseMcpConfig(JSON.stringify({
      mcpServers: { filesystem: { command: "npx" } },
    }));
    const session = parseMcpConfig(JSON.stringify({
      mcpServers: { remote: { url: "https://example.com/mcp" } },
    }));

    expect(Object.keys(mergeMcpConfigs(defaults, session).mcpServers)).toEqual(["filesystem", "remote"]);
    expect(() => mergeMcpConfigs(defaults, parseMcpConfig(JSON.stringify({
      mcpServers: { FileSystem: { command: "bun" } },
    })))).toThrow("conflicts with default server 'filesystem'");
  });

  test("sets and unsets object paths but rejects array indexes", () => {
    const server = { command: "npx", env: { OLD: "value" }, args: ["-y"] };

    expect(setConfigField(server, "env.LOG_LEVEL", "debug")).toEqual({
      command: "npx",
      env: { OLD: "value", LOG_LEVEL: "debug" },
      args: ["-y"],
    });
    expect(unsetConfigField(server, "env.OLD")).toEqual({
      command: "npx",
      env: {},
      args: ["-y"],
    });
    expect(() => setConfigField(server, "args.0", "package")).toThrow("array indexes are not supported");
  });

  test("rejects unsafe server names and object paths", () => {
    expect(() => parseMcpConfig('{"mcpServers":{"__proto__":{"command":"bun"}}}')).toThrow("unsafe name");
    expect(() => setConfigField({ env: {} }, "__proto__.polluted", true)).toThrow("unsafe object key");
    expect(() => unsetConfigField({ env: {} }, "constructor.prototype")).toThrow("unsafe object key");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
