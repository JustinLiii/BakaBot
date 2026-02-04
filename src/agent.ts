import { Agent } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
import * as fs from "fs/promises";

import { readFileTool, listDirTool, webFetchTool } from "./tools.ts";
import console from "console";

async function buildAgent(id: string): Promise<Agent> {
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
      systemPrompt: await fs.readFile("./prompts/sys.md", "utf-8"),
      model: model,
    },
    getApiKey: () => process.env.SILICONFLOW_API_KEY
  });

  agent.sessionId = id;

  agent.setTools([readFileTool, listDirTool, webFetchTool]);

  agent.subscribe((event) => {
    if (event.type === "agent_end") {
      console.log("Agent ended");
    } else if (event.type === "agent_start") {
      console.log("Agent started");
    }
  })
  return agent
}

export { buildAgent };