import { Agent } from "@mariozechner/pi-agent-core";
import type { AgentOptions, AgentState, AgentMessage } from "@mariozechner/pi-agent-core";
import type { Model, ImageContent, TextContent } from "@mariozechner/pi-ai";
import console from "console";
import type { GroupMessage } from "node-napcat-ts";

import { readFileTool, listDirTool, webFetchTool, continueTool, pythonTool, createBashTool } from "./tools.ts";
import { system_prompt } from "./prompts/sys.ts";
import { RagService } from "./utils/rag_service.ts";
import { get_text_content } from "./utils/agent_utils.ts";

class BakaAgent extends Agent {
  pendingGroupFollowUp: GroupMessage[] = [];
  toBeReplied: GroupMessage | null = null;
  rag: RagService;
  contextLimit = 15;
  private lastIndexedIndex = 0;

  constructor(options: AgentOptions) {
    super(options);
    this.rag = new RagService(options.sessionId!);

    // Group follow up processing
    this.subscribe(async (event) => {
      if (event.type !== "agent_end" || this.pendingGroupFollowUp.length <= 0) return;
      // Process pending follow ups
      const followUp = this.pendingGroupFollowUp.shift()!;
      const msg = followUp.raw_message;
      console.log("Processing follow up: " + msg);
      this.toBeReplied = followUp;
      // Add without immediate indexing, it will be indexed in the next agent_end
      this.appendMessage({ role: 'user', content: msg, timestamp: Date.now() });
      this.continue();
    })

    // RAG Logic: Context pruneing and indexing
    this.subscribe(async (event) => {
        if (event.type !== "agent_end") return;
        // 1. Index everything new in history before pruning
        await this.indexPendingMessages();

        // 2. Prune history
        if (this.state.messages.length > this.contextLimit) {
          const removedCount = this.state.messages.length - this.contextLimit;
          this.state.messages = this.state.messages.slice(-this.contextLimit);
          this.lastIndexedIndex = Math.max(0, this.lastIndexedIndex - removedCount);
        }
    })

    // RAG Logic: Context Injection
    this.subscribe(async (event) => {
      if (event.type !== "message_start" || event.message.role !== "user") return;
      try {
        await this.rag.init();
        const query = get_text_content(event.message);
        const memories = await this.rag.search(query);
        
        if (memories.length > 0) {
          const memoryText = memories
            .map(m => `[Memory ${new Date(m.timestamp!).toLocaleString()}] ${m.role}: ${get_text_content(m)}`)
            .join("\n");
          const injection = `\n\n[Historical Context]\n${memoryText}\n[End Context]\n\n`;
          
          if (typeof event.message.content === "string") {
            event.message.content = injection + "新消息：" + event.message.content;
          } else {
            const textIdx = event.message.content.findIndex(c => (c as any).type === "text");
            if (textIdx !== -1) {
              (event.message.content[textIdx] as TextContent).text = injection + "新消息：" + (event.message.content[textIdx] as TextContent).text;
            } else {
              event.message.content.unshift({ type: "text", text: injection } as any);
            }
          }
        }
      } catch (e) {
        console.error("[RAG] Injection failed:", e);
      }
    });


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

  /**
   * Indexes all messages in history that haven't been indexed yet.
   */
  private async indexPendingMessages() {
    try {
      await this.rag.init();
      const pending = this.state.messages.slice(this.lastIndexedIndex);
      for (const msg of pending) {
        await this.rag.add(msg);
      }
      this.lastIndexedIndex = this.state.messages.length;
    } catch (e) {
      console.error("[RAG] Indexing failed:", e);
    }
  }

  /**
   * Adds a message to the conversation history. 
   * Context limit and indexing are handled automatically at agent_end.
   */
  async addMessage(msg: AgentMessage, index: boolean = true) {
    this.appendMessage(msg);
    // If we're not in an agent loop, we should index immediately to avoid losing it
    if (index && !this.state.isStreaming) {
      await this.indexPendingMessages();
    }
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

  agent.setTools([webFetchTool, continueTool, createBashTool(sessionId)]);

  return agent
}

export { buildAgent, BakaAgent };
