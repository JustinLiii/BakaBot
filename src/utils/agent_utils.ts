
import type { Agent, AgentMessage } from "@mariozechner/pi-agent-core";
import type { Context } from "@mariozechner/pi-ai";
import { complete } from "@mariozechner/pi-ai";

async function triggered(msg: string, agent: Agent): Promise<boolean> {
    const msgs: Context = {
        systemPrompt: agent.state.systemPrompt,
        messages: [{ role: 'user', content: `以下消息需要你回复吗？请回答True/False\n你的上一条消息：\n${agent.state.messages[-1]?.content}\n消息：\n${msg}\n`, timestamp: new Date().getTime() }],
    };

    const res = await complete(agent.state.model, msgs, {apiKey: process.env.SILICONFLOW_API_KEY})
    const content = res.content[res.content.length - 1]
    console.log(content)
    if (content?.type === "text") {
        return content.text.toLowerCase().includes("true")
    }
    return false
}

function get_text_content(msg: AgentMessage): string | null {
    if (msg.content instanceof Array) {
        for (const content of msg.content) {
            if (content.type === "text") {
                return content.text
            }
        }
        return null
    } else {
        return msg.content
    }
}

export { triggered, get_text_content }