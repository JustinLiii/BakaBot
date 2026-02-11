
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
  private initialized = false;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.storagePath = path.resolve(process.cwd(), "data", "sessions", sessionId, "rag");
    this.indexPath = path.join(this.storagePath, "rag_index.json");
    this.metadataPath = path.join(this.storagePath, "rag_metadata.json");
    this.voy = new Voy();
  }

  async init() {
    if (this.initialized) return;
    if (await fs.exists(this.indexPath) && await fs.exists(this.metadataPath)) {
      const indexData = await fs.readFile(this.indexPath, "utf-8");
      this.voy = Voy.deserialize(indexData);
      
      const metadataData = await fs.readFile(this.metadataPath, "utf-8");
      this.items = JSON.parse(metadataData) as RagItem[];
      // Items are always sorted
      console.log(`[RAG] Loaded ${this.items.length} items for session ${this.sessionId}`);
    } else {
      console.log(`[RAG] Initializing new index for session ${this.sessionId}`);
      await fs.mkdir(this.storagePath, { recursive: true });
      this.items = [];
    }
    this.initialized = true;
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
    if (!data || !data.data || data.data.length === 0 || !data.data[0]) {
      throw new Error("No embedding returned from API");
    }
    return data.data[0].embedding;
  }

  private async rerank(query: string, documents: string[]): Promise<number[]> {
    if (documents.length === 0) return [];

    const response = await fetch("https://api.siliconflow.cn/v1/rerank", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.SILICONFLOW_API_KEY}`
      },
      body: JSON.stringify({
        model: "BAAI/bge-reranker-v2-m3",
        query: query,
        documents: documents,
        top_n: documents.length,
        return_documents: false
      })
    });

    if (!response.ok) {
      console.error("[RAG] Rerank API failed:", await response.text());
      return documents.map(() => 1.0); // Fallback: return full scores if API fails
    }

    const data = (await response.json()) as { results: { index: number; relevance_score: number }[] };
    const scores = new Array(documents.length).fill(0);
    if (!data || !data.results || data.results.length !== documents.length) throw new Error("Errorous rerank results returned from API, raw response: " + await response.text());
    for (const result of data.results) {
      scores[result.index] = result.relevance_score;
    }
    return scores;
  }

  /**
   * Converts a message to a searchable string representation for embedding/reranking.
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
        title: "",
        url: "", 
        embeddings: embedding
      }]
    });
    
    // Maintain sorted order by timestamp using insertion sort logic (binary search for index)
    let low = 0;
    let high = this.items.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      const midItem = this.items[mid];
      if (midItem && (midItem.timestamp || 0) < timestamp) low = mid + 1;
      else high = mid;
    }
    this.items.splice(low, 0, item);
    
    await this.save();
  }

  /**
   * Searches for relevant messages using Recall + Rerank.
   * @param query The search query
   * @param threshold Minimum relevance score (0.0 to 1.0)
   * @param recallLimit Number of initial candidates to find via vector search
   * @param contextWindow Number of messages to include before and after each filtered match
   */
  async search(query: string, threshold: number = 0.01, recallLimit: number = 10, contextWindow: number = 1): Promise<RagItem[]> {
    if (this.items.length === 0) return [];
    
    // 1. Recall (Vector Search)
    const queryVector = await this.getEmbedding(query);
    const results = this.voy.search(new Float32Array(queryVector), recallLimit);
    
    if (results.neighbors.length === 0) return [];

    // Map recall results to unique items
    const recallItems: RagItem[] = [];
    const recallIndices: number[] = [];
    for (const neighbor of results.neighbors) {
      let low = 0;
      let high = this.items.length - 1;
      while (low <= high) {
        const mid = (low + high) >>> 1;
        const midItem = this.items[mid];
        if (!midItem) break;
        if (midItem.id === neighbor.id) {
          recallItems.push(midItem);
          recallIndices.push(mid);
          break;
        }
        if (midItem.id < neighbor.id) low = mid + 1;
        else high = mid - 1;
      }
    }

    if (recallItems.length === 0) return [];

    // 2. Rerank
    const docsToRerank = recallItems.map(item => this.stringifyMessage(item));
    const scores = await this.rerank(query, docsToRerank); // should match recallItems length

    // 3. Filter and Expand Context (collecting unique indices to maintain chronological order)
    const resultIndicesSet = new Set<number>();

    for (let i = 0; i < recallItems.length; i++) {
      const score = scores[i] as number; // returned scores should align with recallItems
      if (score < threshold) continue;

      const matchIndex = recallIndices[i] as number; // recallIndices should have same length as recallItems

      // Calculate window range
      const start = Math.max(0, matchIndex - contextWindow);
      const end = Math.min(this.items.length - 1, matchIndex + contextWindow);

      for (let j = start; j <= end; j++) {
        resultIndicesSet.add(j);
      }
    }

    // Return items mapped from sorted unique indices
    return Array.from(resultIndicesSet)
      .sort((a, b) => a - b)
      .map(idx => this.items[idx])
      .filter((item): item is RagItem => !!item);
  }

  async save() {
    const indexData = this.voy.serialize();
    await fs.writeFile(this.indexPath, indexData, "utf-8");
    await fs.writeFile(this.metadataPath, JSON.stringify(this.items), "utf-8");
  }
}
