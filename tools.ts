
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import * as fs from "fs/promises";

function processPath(path: string) {
  path = path.replace(/^~/, process.env.HOME);
  return path;
}

const readFileTool: AgentTool = {
  name: "read_file",
  label: "Read File",  // For UI display
  description: "Read a file's contents",
  parameters: Type.Object({
    path: Type.String({ description: "File path" }),
  }),
  execute: async (toolCallId, params, signal, onUpdate) => {
    const path = processPath(params.path);
    console.log(`Reading file: ${path}`);
    const content = await fs.readFile(path, "utf-8");

    // // Optional: stream progress
    // onUpdate?.({ content: [{ type: "text", text: "Reading..." }], details: {} });

    return {
      content: [{ type: "text", text: content }],
      details: { path: path, size: content.length },
    };
  },
};

const listDirTool: AgentTool = {
  name: "list_dir",
  label: "List Directory", 
  description: "List the contents of a directory",
  parameters: Type.Object({
    path: Type.String({ description: "Directory path" }),
  }),
  execute: async (toolCallId, params, signal, onUpdate) => {
    const path = processPath(params.path);
    console.log(`Listing directory: ${path}`);
    const entries = await fs.readdir(path, { recursive: false});

    return {
      content: [{ type: "text", text: entries.join("\n") }],
      details: { path: path, size: entries.length },
    };
  }
}

const webFetchTool: AgentTool = {
  name: "web_fetch",
  label: "Web Fetch", 
  description: "Fetch a web resource",
  parameters: Type.Object({
    url: Type.String({ description: "URL to fetch" }),
  }),
  execute: async (toolCallId, params, signal, onUpdate) => {
    console.log(`Fetching URL: ${params.url}`);
    const response = await fetch(params.url);

    return {
      content: [{ type: "text", text: await response.text() }],
      details: { url: params.url, status: response.status },
    };
  }
}

export { readFileTool, listDirTool, webFetchTool};