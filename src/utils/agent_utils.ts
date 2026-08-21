import type { AgentMessage } from "@mariozechner/pi-agent-core";

function get_text_content(msg: AgentMessage): string {
    if (typeof msg.content === "string") {
        return msg.content;
    }
    return msg.content.filter((c) => c.type === "text")
        .map((c) => c.text.trim())
        .join("");
}

export { get_text_content }