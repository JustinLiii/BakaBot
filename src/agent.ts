import { Agent } from "@mariozechner/pi-agent-core";
import type { AgentOptions, AgentState, AgentMessage, AgentEvent, AgentTool } from "@mariozechner/pi-agent-core";
import type { Model, ImageContent, TextContent } from "@mariozechner/pi-ai";
import console from "console";
import * as fs from "fs/promises";
import * as path from "path";
import type { GroupMessage } from "node-napcat-ts";

import { webFetchTool, continueTool, createBashTool } from "./tools.ts";
import { creatSkillTool } from "./skill_tool.ts";
import { createMcpToolsFromEndpoints } from "./mcp_tool.ts";
import type { McpClientOptions } from "./mcp_tool.ts";
import { system_prompt } from "./prompts/sys.ts";
import { RagService } from "./utils/rag_service.ts";
import { get_text_content } from "./utils/agent_utils.ts";

interface SessionMcpConfig {
  servers: Array<{ endpoint: string; options?: McpClientOptions }>;
}

function getSessionMcpConfigPath(sessionId: string): string {
  return path.resolve(process.cwd(), "data", "sessions", sessionId, "mcp.json");
}

function normalizeSessionMcpConfig(raw: unknown): SessionMcpConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("mcp.json must be an object.");
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.servers)) {
    throw new Error("mcp.json must contain a 'servers' array.");
  }

  const servers = obj.servers.map((item, idx) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`mcp.json servers[${idx}] must be an object.`);
    }
    const serverObj = item as Record<string, unknown>;
    if (typeof serverObj.endpoint !== "string") {
      throw new Error(`mcp.json servers[${idx}].endpoint must be a string.`);
    }
    const endpoint = serverObj.endpoint.trim();
    if (!endpoint) {
      throw new Error(`mcp.json servers[${idx}].endpoint cannot be empty.`);
    }

    if (serverObj.options !== undefined && (!serverObj.options || typeof serverObj.options !== "object" || Array.isArray(serverObj.options))) {
      throw new Error(`mcp.json servers[${idx}].options must be an object when provided.`);
    }

    return {
      endpoint,
      options: serverObj.options as McpClientOptions | undefined,
    };
  });

  return { servers };
}

async function loadSessionMcpConfig(sessionId: string): Promise<SessionMcpConfig> {
  const configPath = getSessionMcpConfigPath(sessionId);
  try {
    const content = await fs.readFile(configPath, "utf-8");
    const parsed = JSON.parse(content);
    return normalizeSessionMcpConfig(parsed);
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return { servers: [] };
    }
    throw new Error(`[MCP] Invalid config at ${configPath}: ${error?.message ?? String(error)}`);
  }
}

class BakaAgent extends Agent {
  pendingGroupFollowUp: {msg: string, reply_action: (reply: string, at_sender?: boolean) => Promise<null>}[] = [];
  toBeReplied: ((reply: string, at_sender?: boolean) => Promise<null>) | null = null;
  rag: RagService;
  contextPruneTriggerSize = 50; // Actural working context size could be larger as pruning could only be triggered at agent_end

  constructor(options: AgentOptions) {
    super(options);
    this.rag = new RagService(options.sessionId!);

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

  async RememberAll(includeToolResult: boolean = false) {
    if (!this.rag.initialized) await this.rag.Initialize();
    if (includeToolResult) {
      await this.state.messages.filter(m => m.role !== "toolResult").map(m =>this.rag.add(m))
    } else {
      await this.state.messages.map(m =>this.rag.add(m))
    }
  }

  async registerMcpTools(endpoints: string[], options?: McpClientOptions): Promise<{ registered: string[]; skipped: string[] }> {
    const tools = await createMcpToolsFromEndpoints(endpoints, options);
    const existingNames = new Set(this.state.tools.map((tool) => tool.name));
    const registerable = tools.filter((tool) => !existingNames.has(tool.name));
    const skipped = tools.filter((tool) => existingNames.has(tool.name)).map((tool) => tool.name);
    if (registerable.length > 0) {
      this.setTools([...this.state.tools, ...registerable]);
    }
    return {
      registered: registerable.map((tool) => tool.name),
      skipped,
    };
  }
}

async function buildAgent(sessionId: string, initialState?: Partial<AgentState>): Promise<BakaAgent> {
  // const model: Model<'openai-completions'> = {
  //   id: 'deepseek-ai/DeepSeek-V3.2',
  //   name: 'DeepSeek-V3.2 (SiliconFlow)',
  //   api: 'openai-completions',
  //   provider: 'SiliconFlow',
  //   baseUrl: 'https://api.siliconflow.cn/v1/',
  //   reasoning: false,
  //   input: ['text'],
  //   cost: { input: 2, output: 3, cacheRead: 2, cacheWrite: 3 },
  //   contextWindow: 163840,
  //   maxTokens: 163840,
  // };

  const model: Model<'openai-completions'> = {
    id: 'deepseek-chat',
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
      // getApiKey: () => process.env.SILICONFLOW_API_KEY
      getApiKey: () => process.env.DEEPSEEK_API_KEY
    });

  agent.setTools([webFetchTool, continueTool, createBashTool(sessionId), creatSkillTool(sessionId)]);
  // load custom mcp tools from <sessionFolder>/mcp.json
  const mcpConfig = await loadSessionMcpConfig(sessionId);
  if (mcpConfig.servers.length > 0) {
    let registeredTotal = 0;
    let skippedTotal = 0;
    for (const server of mcpConfig.servers) {
      try {
        const { registered, skipped } = await agent.registerMcpTools([server.endpoint], server.options);
        registeredTotal += registered.length;
        skippedTotal += skipped.length;
      } catch (error) {
        console.warn(`[MCP] Session ${sessionId}: failed to register ${server.endpoint}`, error);
      }
    }
    console.log(`[MCP] Session ${sessionId}: registered ${registeredTotal}, skipped ${skippedTotal}`);
  }

  return agent
}

export { buildAgent, BakaAgent };
