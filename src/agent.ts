import { Agent } from "@mariozechner/pi-agent-core";
import type { AgentOptions } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
import * as fs from "fs/promises";
import console from "console";
import type { NCWebsocket } from "node-napcat-ts";

import { reply } from "./napcat.ts";
import { readFileTool, listDirTool, webFetchTool, continueTool } from "./tools.ts";

class BakaAgent extends Agent {
  constructor(options: AgentOptions) {
    super(options);
  }
}

async function buildAgent(id: string, napcat: NCWebsocket | undefined): Promise<Agent> {
  const model: Model<'openai-completions'> = {
    id: 'deepseek-ai/DeepSeek-V3.2',
    name: 'DeepSeek-V3.2 (SiliconFlow)',
    api: 'openai-completions',
    provider: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1/',
    reasoning: false,
    input: ['text'],
    cost: { input: 1, output: 4, cacheRead: 1, cacheWrite: 4 },
    contextWindow: 262144,
    maxTokens: 262144,
  };

  const agent = new BakaAgent({
    initialState: {
      systemPrompt: await fs.readFile("./prompts/sys.md", "utf-8"),
      model: model,
    },
    getApiKey: () => process.env.SILICONFLOW_API_KEY
  });

  agent.sessionId = id;

  agent.setTools([readFileTool, listDirTool, webFetchTool, continueTool]);

  // replying
  agent.subscribe(async (event) => {
    if (event.type === "message_end") {
      if (!napcat) return;
      if (event.message.role !== "assistant") return;
      const msg = event.message.content
          .filter((c) => c.type === "text")
          .map((c) => c.text.trim())
          .join("");
      reply(msg, id, napcat)
    }
  })

  // logging
  agent.subscribe((event) => {
    switch (event.type) {
      case "agent_start":
        console.log("[Agent] Started");
        break;
      case "agent_end":
        console.log("[Agent] Ended");
        break;
      case "message_end": {
        let msg = "";
        if (event.message.content instanceof Array) {
          msg = event.message.content
            .filter((c) => c.type === "text")
            .map((c) => c.text)
            .join("");
        } else {
          msg = event.message.content;
        }
        console.log("[Message]", msg.substring(0, 100));
        break;
      }
      case "tool_execution_start":
        console.log("[Tool]", event.toolName);
        break;
    }
  })
  return agent
}

export { buildAgent };