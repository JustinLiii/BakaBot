import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

export const webFetchTool: AgentTool = {
  name: "web_fetch",
  label: "Web Fetch",
  description: "Fetch a web resource",
  parameters: Type.Object({
    url: Type.String({ description: "URL to fetch" }),
  }),
  execute: async (toolCallId, params: any, signal, onUpdate) => {
    console.log(`Fetching URL: ${params.url}`);
    const url = "https://r.jina.ai/" + params.url;
    const response = await fetch(url);
    return {
      content: [{ type: "text", text: await response.text() }],
      details: { url: params.url, status: response.status },
    };
  },
};
