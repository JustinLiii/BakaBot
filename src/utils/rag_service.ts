
import * as fs from "fs/promises";
import * as path from "path";
import { Voy } from "voy-search";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { get_text_content } from "./agent_utils.ts";

export type RagItem = AgentMessage & {
  id: string;
};

export class RagService {
  private voy: Voy;
  private sessionId: string;
  private storagePath: string;
  private indexPath: string;
  private metadataPath: string;
  private items: RagItem[] = [];

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.storagePath = path.resolve(process.cwd(), "data", "sessions", sessionId, "rag");
    this.indexPath = path.join(this.storagePath, "rag_index.json");
    this.metadataPath = path.join(this.storagePath, "rag_metadata.json");
    this.voy = new Voy();
  }

  async init() {
    await fs.mkdir(this.storagePath, { recursive: true });
    try {
      const indexData = await fs.readFile(this.indexPath, "utf-8");
      this.voy = Voy.deserialize(indexData);
      
      const metadataData = await fs.readFile(this.metadataPath, "utf-8");
      this.items = JSON.parse(metadataData);
      // Ensure items are sorted after load
      this.items.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      console.log(`[RAG] Loaded ${this.items.length} items for session ${this.sessionId}`);
    } catch (e) {
      console.log(`[RAG] Initializing new index for session ${this.sessionId}`);
      this.voy = new Voy();
      this.items = [];
    }
  }

  private async getEmbedding(text: string): Promise<number[]> {
    const response = await fetch("https://api.siliconflow.cn/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.SILICONFLOW_API_KEY}`
      },
      body: JSON.stringify({
        model: "BAAI/bge-m3",
        input: text
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch embedding: ${await response.text()}`);
    }

    const data = (await response.json()) as { data: { embedding: number[] }[] };
    if (!data.data || data.data.length === 0 || !data.data[0]) {
      throw new Error("No embedding returned from API");
    }
    return data.data[0].embedding;
  }

  /**
   * Converts a message to a searchable string representation for embedding.
   */
  private stringifyMessage(msg: AgentMessage): string {
    let content = get_text_content(msg);
    
    // Handle Tool Calls in Assistant Message
    if (msg.role === "assistant" && "content" in msg && Array.isArray(msg.content)) {
      const calls = msg.content
        .filter(c => c.type === "toolCall")
        .map(tc => `Tool Call: ${(tc as any).name}(${JSON.stringify((tc as any).arguments)})`)
        .join("\n");
      if (calls) content = `${content}\n${calls}`.trim();
    }
    
    // Handle Tool Results
    if (msg.role === "toolResult") {
      content = `Tool Result (${(msg as any).toolName}): ${content}`;
    }

    return content;
  }

  async add(msg: AgentMessage) {
    const textToEmbed = this.stringifyMessage(msg);
    if (!textToEmbed.trim()) return;
    
    const timestamp = msg.timestamp || Date.now();
    const id = `${timestamp}-${Math.random().toString(36).substring(2, 9)}`;
    const embedding = await this.getEmbedding(textToEmbed);
    
    const item: RagItem = { ...msg, id, timestamp } as RagItem;
    
    // Voy adds items
    this.voy.add({
      embeddings: [{
        id: id,
        title: "", // Space saving: don't store text twice
        url: "", 
        embeddings: embedding
      }]
    });
    
    // Maintain sorted order by timestamp using insertion sort logic (binary search for index)
    let low = 0;
    let high = this.items.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if ((this.items[mid].timestamp || 0) < timestamp) low = mid + 1;
      else high = mid;
    }
    this.items.splice(low, 0, item);
    
    await this.save();
  }

  /**
   * Searches for relevant messages and optionally returns surrounding context.
   * @param query The search query
   * @param limit Number of direct matches to find
   * @param contextWindow Number of messages to include before and after each match
   */
  async search(query: string, limit: number = 3, contextWindow: number = 2): Promise<RagItem[]> {
    if (this.items.length === 0) return [];
    
    const queryVector = await this.getEmbedding(query);
    const results = this.voy.search(new Float32Array(queryVector), limit);
    
    const resultIds = new Set<string>();
    const finalItems: RagItem[] = [];

    for (const neighbor of results.neighbors) {
      // Since ids are prefixed with timestamp and items are sorted by timestamp,
      // we can use binary search on id (string comparison)
      let low = 0;
      let high = this.items.length - 1;
      let matchIndex = -1;

      while (low <= high) {
        const mid = (low + high) >>> 1;
        const midId = this.items[mid].id;
        if (midId === neighbor.id) {
          matchIndex = mid;
          break;
        }
        if (midId < neighbor.id) low = mid + 1;
        else high = mid - 1;
      }

      if (matchIndex === -1) continue;

      // Calculate window range
      const start = Math.max(0, matchIndex - contextWindow);
      const end = Math.min(this.items.length - 1, matchIndex + contextWindow);

      for (let i = start; i <= end; i++) {
        const item = this.items[i];
        if (item && !resultIds.has(item.id)) {
          resultIds.add(item.id);
          finalItems.push(item);
        }
      }
    }

    // Ensure chronological order across multiple matches
    return finalItems
  }

  async save() {
    const indexData = this.voy.serialize();
    await fs.writeFile(this.indexPath, indexData, "utf-8");
    await fs.writeFile(this.metadataPath, JSON.stringify(this.items), "utf-8");
  }
}
