import type { AgentMessage } from "@mariozechner/pi-agent-core";

function triggerMsg(msg: string, history: AgentMessage[]): string {
    const history_str = history.filter(m => m.role === "user" || m.role === "assistant").map(m => {
        if (m.role === "user") {
            return `${m.content}`;
        } else {
            return `你: ${m.content}`;
        }
    }).join("\n---\n");

    return `你在一个群聊里，群聊可能有很多与你无关的信息，请判断以下消息是否需要你回复
- 只有在确实存在与你相关或者与你之前谈论的话题有关的消息时，你才需要回复
- 只许回答一个字：是/否

历史记录
${history_str}

消息：
${msg}
`;
}

export { triggerMsg }