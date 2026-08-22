import { Agent } from "@mariozechner/pi-agent-core";
import type { AgentOptions, AgentState, AgentMessage, AgentTool } from "@mariozechner/pi-agent-core";
import type { Model, ImageContent, TextContent } from "@mariozechner/pi-ai";
import console from "console";

import { continueTool, BashSandbox, webSearchTool, createBashTool, createMcpManagementTools, createRefreshSkillTool } from "./tools/index.ts";
import { McpManager } from "./mcp/manager.ts";
import { system_prompt } from "./prompts/sys.ts";
import { RagService } from "./utils/rag_service.ts";
import { get_text_content } from "./utils/agent_utils.ts";
import { loadSkillRegPrompt } from "./skill/skill.ts";

class BakaAgent extends Agent {
  pendingGroupFollowUp: {msg: string, reply_action: (reply: string, at_sender?: boolean) => Promise<null>}[] = [];
  toBeReplied: ((reply: string, at_sender?: boolean) => Promise<null>) | null = null;
  rag: RagService;
  mcpManager?: McpManager;
  bashSandbox?: BashSandbox;
  contextPruneTriggerSize = 50; // Actural working context size could be larger as pruning could only be triggered at agent_end
  readonly customSystemPrompt: string; // Custom system prompt. Without framework managed parts like tool / skill registries.

  constructor(options: AgentOptions) {
    super(options);
    this.rag = new RagService(options.sessionId!);
    this.customSystemPrompt = options.initialState?.systemPrompt ?? "";

    // Dispatch events
    this.subscribe(async (event) => {
      switch (event.type) {
        case "agent_end":
          await this.ContextPruningAndIndexing(event);

          // process follow up in the end
          await this.ProcessGroupFollowUp(event);
          break;
          
        case "message_start":
          await this.RAGContextInjection(event);
          break;

        default:
          break;
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

  private async RAGContextInjection(event: { type: "message_start"; message: AgentMessage; }) { 
    if (event.message.role !== "user") return;
    if (!this.rag.initialized) await this.rag.Initialize();
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
  }

  private ProcessGroupFollowUp(event: { type: "agent_end"; messages: AgentMessage[];}) {
    if (this.pendingGroupFollowUp.length <= 0) return;
    // Process pending follow ups
    const followUp = this.pendingGroupFollowUp.shift()!;
    const msg = followUp.msg;
    console.log("Processing follow up: " + msg);
    this.toBeReplied = followUp.reply_action;
    // Add without immediate indexing, it will be indexed in the next agent_end
    this.appendMessage({ role: 'user', content: msg, timestamp: Date.now() });
    this.continue();
  }

  private async ContextPruningAndIndexing(event: { type: "agent_end"; messages: AgentMessage[];}) { 
    if (this.state.messages.length <= this.contextPruneTriggerSize) return;

    // calculate remove size
    const minRemoveSize = Math.max(0, this.state.messages.length - this.contextPruneTriggerSize);
    let removeSize = minRemoveSize;
    for (let i = removeSize; i < this.state.messages.length; i++) {
      const msg = this.state.messages[i] as AgentMessage;
      if (msg.role === "user") {
        removeSize = i; // Prune until user message
        break;
      }
    }

    // 1. Index everything to be removed before pruning
    if (!this.rag.initialized) await this.rag.Initialize();
    await this.rememberMessages(this.state.messages.slice(undefined, removeSize));

    // 2. Prune history
    this.state.messages = this.state.messages.slice(removeSize, undefined);
  }

  /**
   * Indexes all messages in history that haven't been indexed yet.
   */
  public async rememberMessages(messages: AgentMessage[], includeToolResult: boolean = false) {
    if (!this.rag.initialized) await this.rag.Initialize();
    const msg_to_memorize = includeToolResult ? messages : messages.filter(m => m.role !== "toolResult");
    const promises = [];
    for (const msg of msg_to_memorize) {
      if (typeof msg.content === "string") {
        const spilts = msg.content.split("[End Context]\n\n");
         msg.content = (spilts[spilts.length - 1] as string);
      } else {
        const textIdx = msg.content.findIndex(c => (c as any).type === "text");
        if (textIdx !== -1) {
            const splits = (msg.content[textIdx] as TextContent).text.split("[End Context]\n\n");
            (msg.content[textIdx] as TextContent).text = (splits[splits.length - 1] as string)
        } else {
          continue; // Nothing to memorize
        }
      }
      promises.push(this.rag.add(msg));
    }
    await Promise.all(promises);
  }

  addMessage(msg: AgentMessage) {
    this.appendMessage(msg);
    this.ContextPruningAndIndexing({ type: "agent_end", messages: [] });
  }

  GroupfollowUp(msg: string, reply_action: (reply: string, at_sender?: boolean) => Promise<null>) {
    this.pendingGroupFollowUp.push({
      msg: msg,
      reply_action: reply_action
    });
  }

  async refreshSkillRegistry() {
    this.setSystemPrompt(this.customSystemPrompt + await loadSkillRegPrompt(this.sessionId!));
  }

  async RememberAll(includeToolResult: boolean = false) {
    if (!this.rag.initialized) await this.rag.Initialize();
    if (includeToolResult) {
      await this.state.messages.filter(m => m.role !== "toolResult").map(m =>this.rag.add(m))
    } else {
      await this.state.messages.map(m =>this.rag.add(m))
    }
  }

  async stopCurrentWork(): Promise<void> {
    this.abort();
    await this.bashSandbox?.killActiveProcess();
  }

  async shutdownSandbox(): Promise<void> {
    await this.stopCurrentWork();
    await this.bashSandbox?.killContainer();
  }

}

async function buildAgent(sessionId: string, initialState?: Partial<AgentState>): Promise<BakaAgent> {

  const model: Model<'openai-completions'> = {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek-Latest',
    api: 'openai-completions',
    provider: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1/',
    reasoning: false,
    input: ['text'],
    cost: { input: 2, output: 3, cacheRead: 0.2, cacheWrite: 3 },
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
      getApiKey: () => process.env.DEEPSEEK_API_KEY
    });

  
  await agent.refreshSkillRegistry();

  agent.bashSandbox = new BashSandbox(sessionId);
  const baseTools = [continueTool, createBashTool(agent.bashSandbox), createRefreshSkillTool(agent), webSearchTool];
  let managementTools: AgentTool[] = [];
  let mcpTools: AgentTool[] = [];
  agent.mcpManager = await McpManager.create({
    sessionId,
    reservedToolNames: baseTools.map((tool) => tool.name),
    reserveMcpManagementToolNames: true,
    onToolsChanged: (nextMcpTools: AgentTool[]): void => {
      mcpTools = nextMcpTools;
      agent.setTools([...baseTools, ...managementTools, ...mcpTools]);
    },
  });
  managementTools = createMcpManagementTools(agent.mcpManager);
  agent.setTools([...baseTools, ...managementTools, ...mcpTools]);

  return agent
}

export { buildAgent, BakaAgent };
