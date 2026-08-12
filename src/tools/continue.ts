import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

export const continueTool: AgentTool = {
  name: "continue",
  label: "Continue",
  description: "Call this tool if you want to continue your response in the next turn",
  parameters: Type.Object({}),
  execute: async (toolCallId, params: any, signal, onUpdate) => {
    console.log("Continuing response");
    return {
      content: [{ type: "text", text: "Please continue your response..." }],
      details: {},
    };
  },
};
