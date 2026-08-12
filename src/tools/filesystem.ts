import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import * as fs from "fs/promises";

function processPath(filePath: string): string {
  return filePath.replace(/^~/, process.env.HOME!);
}

export const readFileTool: AgentTool = {
  name: "read_file",
  label: "Read File",
  description: "Read a file's contents",
  parameters: Type.Object({
    path: Type.String({ description: "File path" }),
  }),
  execute: async (toolCallId, params: any, signal, onUpdate) => {
    const filePath = processPath(params.path);
    console.log(`Reading file: ${filePath}`);
    const content = await fs.readFile(filePath, "utf-8");

    return {
      content: [{ type: "text", text: content }],
      details: { path: filePath, size: content.length },
    };
  },
};

export const listDirTool: AgentTool = {
  name: "list_dir",
  label: "List Directory",
  description: "List the contents of a directory",
  parameters: Type.Object({
    path: Type.String({ description: "Directory path" }),
  }),
  execute: async (toolCallId, params: any, signal, onUpdate) => {
    const directoryPath = processPath(params.path);
    console.log(`Listing directory: ${directoryPath}`);
    const entries = await fs.readdir(directoryPath, { recursive: false });

    return {
      content: [{ type: "text", text: entries.join("\n") }],
      details: { path: directoryPath, size: entries.length },
    };
  },
};
