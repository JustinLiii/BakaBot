import type {
    GroupMessage,
    PrivateFriendMessage,
    PrivateGroupMessage,
    SendMessageSegment,
    NCWebsocket
} from "node-napcat-ts";
import { Structs } from "node-napcat-ts";

import { segmentToString } from "../prompts/napcat_templates";
async function reply(message: string | SendMessageSegment[], sessionId: string, napcat: NCWebsocket): Promise<void> {
    const msg = Array.isArray(message) ? message : [Structs.text(message)]
    if (sessionId.startsWith("g")) {
        await napcat.send_group_msg({
            group_id: Number(sessionId.slice(1)),
            message: msg
        })
    } else {
        await napcat.send_private_msg({
            user_id: Number(sessionId),
            message: msg
        })

    }
    console.log(`[Napcat] Sent message to ${sessionId}: ${Array.isArray(message) ? message.map(segmentToString).join(" ") : message}`)
}

function atMe(context: GroupMessage): boolean {
    for (const message of context.message) {
        if (message.type === "at" && message.data.qq === String(context.self_id)) {
            return true
        }
    }
    return false
}

function getId(context: GroupMessage | PrivateFriendMessage | PrivateGroupMessage): string {
    if (context.message_type === "group") {
        return "g" + String(context.group_id)
    } else {
        return String(context.sender.user_id)
    }
}

export { atMe, getId, reply }