
import type { AgentTool, AgentToolResult, AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { NCWebsocket } from "node-napcat-ts";
import { Structs } from "node-napcat-ts";
import * as fs from "fs/promises";
import { Agent } from "http";

function processPath(path: string) {
  path = path.replace(/^~/, process.env.HOME!);
  return path;
}

// class sendMessageTool implements AgentTool {
//   napcat: NCWebsocket;
//   name = "send_message"
//   label = "Send Message" 
//   description = "Send a message"
//   parameters = Type.Object({
//     message: Type.String({ description: "Message to send" }),
//   })

//   constructor(napcat: NCWebsocket, private readonly id: string) {
//     this.napcat = napcat;
//   }
//   async execute (toolCallId: string, params: unknown, signal?: AbortSignal, onUpdate?: AgentToolUpdateCallback<any> | undefined): Promise<AgentToolResult<any>> {
//     if (this.id.startsWith("g")) {
//       await this.napcat.send_group_msg({
//         group_id: Number(this.id.slice(1)),
//         message: [Structs.text(params.message)]
//       })
//     } else {
//       await this.napcat.send_private_msg({
//         user_id: Number(this.id),
//         message: [Structs.text(params.message)]
//       })

//     }
//     console.log(`Sent message to ${this.id}: ${params.message}`)
//     return {
//       content: [{ type: "text", text: "Message sent." }],
//       details: {},
//     }
//   }
// }

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
    const url = "https://r.jina.ai/" + params.url
    const response = await fetch(url);
    return {
      content: [{ type: "text", text: await response.text() }],
      details: { url: params.url, status: response.status },
    };
  }
}

const continueTool: AgentTool = {
  name: "continue",
  label: "Continue",
  description: "Call this tool if you want to continue your response in the next turn",
  parameters: Type.Object({}),
  execute: async (toolCallId, params, signal, onUpdate) => {
    console.log(`Continuing response`);
    return {
      content: [{ type: "text", text: "Please continue your response..." }],
      details: {},
    }
  }
}

export { readFileTool, listDirTool, webFetchTool, continueTool};