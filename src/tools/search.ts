import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { tavily } from "@tavily/core";

export const webSearchTool: AgentTool = {
  name: "web_search",
  label: "web_search",
  description: "Search for web result",
  parameters: Type.Object({
    query: Type.String({ description: "Key word to query" }),
  }),
  execute: async (toolCallId, params: any, signal, onUpdate) => {
    const query = (params as { query: string }).query;
    console.log(`Searching for ${query}`);
    const client = tavily({ apiKey: process.env.TAVILY_API_KEY});
    const result_raw = await client.search(query, {
        searchDepth: "basic",
        maxResults: 10
    });
    const result = result_raw.results.map((res) => `[${res.title}](${res.url}):\n${res.content}`).join("\n\n")
    return {
      content: [{ type: "text", text: result }],
      details: {},
    };
  },
};
