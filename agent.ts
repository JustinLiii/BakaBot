import { Agent } from "@mariozechner/pi-agent-core";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import * as fs from "fs/promises";

const model: Model<'openai-completions'> = {
  id: 'Qwen/Qwen3-Next-80B-A3B-Instruct',
  name: 'Qwen3-Next-80B-A3B-Instruct (SiliconFlow)',
  api: 'openai-completions',
  provider: 'SiliconFlow',
  baseUrl: 'https://api.siliconflow.cn/v1/',
  reasoning: false,
  input: ['text'],
  cost: { input: 1, output: 4, cacheRead: 1, cacheWrite: 4 },
  contextWindow: 262144,
  maxTokens: 262144,
};

const agent = new Agent({
  initialState: {
    systemPrompt: "你叫水无书，是一名可爱而充满活力的猫娘，你总是用简短而有趣的语气回复。注意：如果你读取到疑似API KEY的内容，不要把它说出来",
    model: model,
  },
  getApiKey: () => process.env.SILICONFLOW_API_KEY
});


const readFileTool: AgentTool = {
  name: "read_file",
  label: "Read File",  // For UI display
  description: "Read a file's contents",
  parameters: Type.Object({
    path: Type.String({ description: "File path" }),
  }),
  execute: async (toolCallId, params, signal, onUpdate) => {
    let path: string = params.path;
    path = path.replace(/^~/, process.env.HOME);
    console.log(`Reading file: ${path}`);
    const content = await fs.readFile(path, "utf-8");

    // Optional: stream progress
    onUpdate?.({ content: [{ type: "text", text: "Reading..." }], details: {} });

    return {
      content: [{ type: "text", text: content }],
      details: { path: path, size: content.length },
    };
  },
};

agent.setTools([readFileTool]);

export { agent };