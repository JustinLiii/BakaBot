import { Agent, agentLoop } from "@mariozechner/pi-agent-core";
import type { AgentMessage, AgentOptions } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
import * as fs from "fs/promises";
import console from "console";
import type { NCWebsocket, GroupMessage } from "node-napcat-ts";

import { readFileTool, listDirTool, webFetchTool, continueTool } from "./tools.ts";

type QQSessionExtra = {
  chatId?: string;
  selfId?: string;
  userInfo?: string;
  groupInfo?: string;
};

class BakaAgent extends Agent {
  pendingGroupFollowUp: GroupMessage[] = [];
  toBeReplied: GroupMessage | null = null;
  extra?: QQSessionExtra;
  constructor(options: AgentOptions, extra?: QQSessionExtra) {
    if (options.initialState) {
      options.initialState.systemPrompt += extra && extra.selfId ? `\n你的QQ号是${extra.selfId}.\n` : ""; // TODO: Prompt template
      options.initialState.systemPrompt += extra && extra.groupInfo ? `\n本群信息：\n${extra.groupInfo}\n` : "";
      options.initialState.systemPrompt += extra && extra.userInfo ? `\n与你对话的用户信息：\n${extra.userInfo}\n` : "";
    }

    super(options);
    this.extra = extra;

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

async function buildAgent(extra: QQSessionExtra | undefined, options?: Partial<AgentOptions>): Promise<BakaAgent> {
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
  }, extra);

  agent.setTools([readFileTool, listDirTool, webFetchTool, continueTool]);

  return agent
}

export { buildAgent, BakaAgent };