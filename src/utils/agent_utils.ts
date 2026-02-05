import type { Agent, AgentMessage } from "@mariozechner/pi-agent-core";
import type { Context } from "@mariozechner/pi-ai";
import { complete } from "@mariozechner/pi-ai";

async function triggered(msg: string, agent: Agent): Promise<boolean> {
    const msgs: Context = {
        systemPrompt: agent.state.systemPrompt,
        messages: [...agent.state.messages, { role: 'user', content: `你在一个群聊里，你的历史记录可能有很多与你无关的信息，请判断以下消息需要你回复吗？只许回答一个字：是/否\n消息：\n${msg}\n`, timestamp: new Date().getTime() }],
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