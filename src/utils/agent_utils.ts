import type { Agent, AgentMessage } from "@mariozechner/pi-agent-core";
import type { Context } from "@mariozechner/pi-ai";
import { complete } from "@mariozechner/pi-ai";

import { triggerMsg } from "../prompts/prompts";

/**
 * Determines if an agent should be triggered based on a message.
 * 
 * NOTE: the agent's history should NOT include the current message.
 * 
 * @param msg - The message to evaluate. 
 * @param agent - The agent to check against. 
 * @returns A promise that resolves to true if the agent should be triggered, false otherwise
 * 
 * @throws May throw if the API call fails or if the response format is unexpected
 */
async function triggered(msg: string, agent: Agent): Promise<boolean> {
    const msgs: Context = {
        systemPrompt: agent.state.systemPrompt,
        messages: [{ role: 'user', content: triggerMsg(msg, agent.state.messages), timestamp: new Date().getTime() }],
    };

    const res = await complete(agent.state.model, msgs, {apiKey: process.env.SILICONFLOW_API_KEY})
    const content = res.content[res.content.length - 1]
    console.log(content)
    if (content?.type === "text") {
        return content.text.includes("是")
    }
    return false
}

function get_text_content(msg: AgentMessage): string {
    if (typeof msg.content === "string") {
        return msg.content;
    }
    return msg.content.filter((c) => c.type === "text")
        .map((c) => c.text.trim())
        .join("");
}

export { triggered, get_text_content }