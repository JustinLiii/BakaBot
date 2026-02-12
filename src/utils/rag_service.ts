import * as path from "path";
import * as lancedb from "@lancedb/lancedb";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { get_text_content } from "./agent_utils.ts";
import * as arrow from "apache-arrow";

const RagSchema = new arrow.Schema([
  new arrow.Field("role", new arrow.Utf8()),
  new arrow.Field("content", new arrow.Utf8()),
  new arrow.Field("timestamp", new arrow.Int8()),
  new arrow.Field(
    "vector",
    new arrow.FixedSizeList(
      1024, // BAAI/bge-m3
      new arrow.Field("item", new arrow.Float32(), true),
    ),
  ),
]);

type RagItem = {
  role: string;
  content: string;
  timestamp: number;
  vector: number[];
};

export class RagService {
  private DEFAULT_TABLE_NAME = "memory";

  private db: lancedb.Connection | undefined;
  private table: lancedb.Table | undefined;
  private sessionId: string;
  private storagePath: string;
  // private indexPath: string;
  // private initialized = false;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.storagePath = path.resolve(process.cwd(), "data", "sessions", sessionId, "rag");
    // this.indexPath = path.join(this.storagePath, "rag_index.json");
    // this.metadataPath = path.join(this.storagePath, "rag_metadata.json");
  }

  async Initialize() {
    this.db = await lancedb.connect(this.storagePath);
    try {
      this.table = await this.db.openTable(this.DEFAULT_TABLE_NAME);
    } catch (e) {
      if (e instanceof Error && e.message.includes(`Table '${this.DEFAULT_TABLE_NAME}' was not found`)) {
        this.table = await this.db.createEmptyTable(this.DEFAULT_TABLE_NAME, RagSchema)
      } else {
        throw e;
      }
    }
  }

  private async PeriodicOptimize(table: lancedb.Table) {
    if((await table.stats()).numRows % 1000 === 0) {
      table.optimize();
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
    const item: RagItem = {
      role: msg.role,
      content: textToEmbed,
      timestamp: msg.timestamp || Date.now(),
      vector: await this.getEmbedding(textToEmbed),
    }

    if (!this.table) throw new Error("RAG service not initialized, table not found.");

    this.table.add([item]);
    // this.PeriodicOptimize(this.table); TODO: concurrent access could cause additional optimization operations
  }

  /**
   * Searches for relevant messages using Recall + Rerank.
   * @param query The search query
   * @param threshold Minimum relevance score (0.0 to 1.0)
   * @param recallLimit Number of initial candidates to find via vector search
   * @param contextWindow Number of messages to include before and after each filtered match
   */
  async search(query: string, threshold: number = 0.01, recallLimit: number = 10, contextWindow: number = 1): Promise<AgentMessage[]> {

    // 1. Recall (Vector Search)
    if (!this.table) throw new Error("RAG service not initialized, table not found.");
    const table = this.table;
    const queryVector = await this.getEmbedding(query);
    const results = await table.search(queryVector).limit(recallLimit).toArray() as RagItem[];
    
    if (results.length === 0) return [];

    // 2. Rerank
    const docsToRerank = results.map(item => item.content);
    const scores = await this.rerank(query, docsToRerank); // should match results length

    // 3. Filter and Expand Context 
    // TODO: get histories just before and after the retrived item

    // Return items mapped from sorted unique indices
    return Array.from(results)
      .sort((a, b) => a.timestamp - b.timestamp)
      .filter((item, i) => scores[i]! >= threshold)
      .map((item) => {
        return {
          role: item.role,
          content: item.content,
          timestamp: item.timestamp,
        } as AgentMessage;
      })
  }
}
