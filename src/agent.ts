import { Agent } from "@mariozechner/pi-agent-core";
import type { AgentOptions, AgentState } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
import console from "console";
import type { GroupMessage } from "node-napcat-ts";

import { readFileTool, listDirTool, webFetchTool, continueTool, pythonTool, createBashTool } from "./tools.ts";
import { system_prompt } from "./prompts/sys.ts";

class BakaAgent extends Agent {
  pendingGroupFollowUp: GroupMessage[] = [];
  toBeReplied: GroupMessage | null = null;

  constructor(options: AgentOptions) {
    super(options);

    // Group follow up processing
    this.subscribe(async (event) => {
      if (event.type === "agent_end") {
        // process pending follow ups
        if (this.pendingGroupFollowUp.length > 0) {
          const followUp = this.pendingGroupFollowUp.shift()!;
          const msg = followUp.raw_message;
          console.log("Processing follow up: " + msg);
          this.toBeReplied = followUp;
          this.appendMessage({'role': 'user', 'content': msg, timestamp: new Date().getTime() });
          this.continue();
        }
      }
    })

    // logging
    this.subscribe((event) => {
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
        case "turn_start":
          console.log("[Turn] Started");
          break;
        case "turn_end":
          console.log("[Turn] Ended");
          break;
      }
    })
  }
  GroupfollowUp(content: GroupMessage) {
    this.pendingGroupFollowUp.push(content);
  }
}

async function buildAgent(sessionId: string, initialState?: Partial<AgentState>): Promise<BakaAgent> {
  const model: Model<'openai-completions'> = {
    id: 'deepseek-ai/DeepSeek-V3.2',
    name: 'DeepSeek-V3.2 (SiliconFlow)',
    api: 'openai-completions',
    provider: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1/',
    reasoning: false,
    input: ['text'],
    cost: { input: 2, output: 3, cacheRead: 2, cacheWrite: 3 },
    contextWindow: 163840,
    maxTokens: 163840,
  };

  const defaultState: Partial<AgentState> = {
    systemPrompt: system_prompt,
    model: model,
  };

  const agent = new BakaAgent(
    {
      sessionId: sessionId,
      initialState: {
        ...defaultState,
        ...initialState,
      },
      getApiKey: () => process.env.SILICONFLOW_API_KEY
    });

  agent.setTools([readFileTool, listDirTool, webFetchTool, continueTool, pythonTool, createBashTool(sessionId)]);

  return agent
}

export { buildAgent, BakaAgent };