import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "fs/promises";
import * as path from "path";

import { createReadImageTool } from "../src/tools/read_image.ts";

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const testRoots: string[] = [];

afterEach(async () => {
  await Promise.all(testRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function createTestRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join("/tmp", "bakabot-read-image-"));
  testRoots.push(root);
  return root;
}

function sessionWorkspace(root: string, sessionId: string): string {
  return path.join(root, "data", "sessions", sessionId, "workspace");
}

describe("read_image tool", () => {
  test("reads an image from the current session workspace", async () => {
    const root = await createTestRoot();
    const workspace = sessionWorkspace(root, "session-a");
    await fs.mkdir(workspace, { recursive: true });
    await fs.writeFile(path.join(workspace, "picture.png"), PNG_BYTES);

    const tool = createReadImageTool("session-a", root);
    const result = await tool.execute("call-1", { source: "/root/picture.png" });

    expect(result.content).toEqual([{
      type: "image",
      data: PNG_BYTES.toString("base64"),
      mimeType: "image/png",
    }]);
  });

  test("maps the sandbox home, shell-style and workspace-relative paths", async () => {
    const root = await createTestRoot();
    const workspace = sessionWorkspace(root, "session-a");
    await fs.mkdir(path.join(workspace, "nested"), { recursive: true });
    await fs.writeFile(path.join(workspace, "nested", "picture.png"), PNG_BYTES);

    const tool = createReadImageTool("session-a", root);

    for (const [callId, source] of [
      ["call-tilde", "~/nested/picture.png"],
      ["call-relative", "nested/picture.png"],
      ["call-absolute", "/root/nested/picture.png"],
    ] as const) {
      const result = await tool.execute(callId, { source });
      expect(result.content[0]).toMatchObject({ type: "image", mimeType: "image/png" });
    }
  });

  test("keeps URL downloads in the session directory, outside the mounted workspace", async () => {
    const root = await createTestRoot();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (): Promise<Response> => new Response(PNG_BYTES, {
      headers: { "content-type": "image/png" },
    })) as unknown as typeof fetch;

    try {
      const tool = createReadImageTool("session-b", root);
      const result = await tool.execute("call-2", { source: "https://example.com/picture.png" });
      const downloadedPath = result.details.path;

      expect(result.content[0]).toEqual({
        type: "image",
        data: PNG_BYTES.toString("base64"),
        mimeType: "image/png",
      });
      expect(downloadedPath.startsWith(path.join(root, "data", "sessions", "session-b", "tmp", "read_image"))).toBe(true);
      expect(downloadedPath.startsWith(sessionWorkspace(root, "session-b"))).toBe(false);
      expect(await fs.readFile(downloadedPath)).toEqual(PNG_BYTES);
      expect(downloadedPath.includes(path.join("sessions", "session-a"))).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("refuses paths outside the mounted workspace", async () => {
    const root = await createTestRoot();
    const tool = createReadImageTool("session-d", root);

    const escaped = await tool.execute("call-6", { source: "/etc/passwd" });
    expect(escaped.content).toEqual([{
      type: "text",
      text: expect.stringContaining("inside the session workspace"),
    }]);
  });

  test("returns a text result and logs when the source cannot be read", async () => {
    const root = await createTestRoot();
    const tool = createReadImageTool("session-c", root);
    const originalFetch = globalThis.fetch;
    const originalError = console.error;
    const logs: string[] = [];
    globalThis.fetch = (async (input: unknown): Promise<Response> => {
      if (String(input).includes("not-found")) {
        return new Response(null, { status: 404 });
      }
      throw new Error("network unavailable");
    }) as unknown as typeof fetch;
    console.error = (...args: unknown[]): void => {
      logs.push(args.map(String).join(" "));
    };

    try {
      const missingFile = await tool.execute("call-3", { source: "/root/missing.png" });
      const missingUrl = await tool.execute("call-4", { source: "https://example.com/not-found.png" });
      const badUrl = await tool.execute("call-5", { source: "https://example.com/network-error.png" });

      expect(missingFile.content).toEqual([{
        type: "text",
        text: expect.stringContaining("ENOENT"),
      }]);
      expect(missingUrl.content).toEqual([{
        type: "text",
        text: expect.stringContaining("HTTP 404"),
      }]);
      expect(badUrl.content).toEqual([{
        type: "text",
        text: expect.stringContaining("Failed to read image"),
      }]);
      expect(logs).toHaveLength(3);
    } finally {
      globalThis.fetch = originalFetch;
      console.error = originalError;
    }
  });
});
