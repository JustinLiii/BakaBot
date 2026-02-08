import type {
    GroupMessage,
    PrivateFriendMessage,
    PrivateGroupMessage,
    SendMessageSegment,
    NCWebsocket
} from "node-napcat-ts";
import { Structs } from "node-napcat-ts";

function segmentToString(segment: SendMessageSegment): string {
    switch (segment.type) {
        case "text":
            return segment.data.text;
        case "image":
            return "[图片]";
        case "at":
            return `[@:${segment.data.qq}]`;
        case "face":
            return "[表情]";
        case "contact":
            return `[联系人:${segment.data.id}]`;
        case "file":
            return `[文件:${segment.data.file}]`;
        case "forward":
            return "[转发]";
        case "json":
            return `${segment.data.data}`;
        case "markdown":
            return `${segment.data.content}`;
        case "mface":
            return "[表情包]";
        case "music":
            return `[音乐]`;
        case "record":
            return "[语音]";
        case "video":
            return "[视频]";
        case "node":
            return "[转发]";
        case "reply":
            return "[回复]";
        case "dice":
            return `[掷骰子]${segment.data.value}`;
        case "rps":
            return `[猜拳]${segment.data.result}`;
        default:
            return "[未知消息类型]";
        // TODO: forward, reply node
    }
}

function eventToString(event: GroupMessage | PrivateFriendMessage | PrivateGroupMessage): string {
    let msg = "";
    if (event.message_type === "group") {
        let roleString = "";
        switch (event.sender.role) {
            case ("owner"):
                roleString = " - 群主";
                break;
            case ("admin"):
                roleString = " - 管理员";
                break;
        }
        msg += `[用户 ${event.sender.nickname} (${event.sender.user_id}) ${roleString}] `;
    }
    return msg + event.message.map(segmentToString).join(" ");
}

async function reply(message: string | SendMessageSegment[], id: string, napcat: NCWebsocket): Promise<void> {
    const msg = Array.isArray(message) ? message : [Structs.text(message)]
    if (id.startsWith("g")) {
        await napcat.send_group_msg({
            group_id: Number(id.slice(1)),
            message: msg
        })
    } else {
        await napcat.send_private_msg({
            user_id: Number(id),
            message: msg
        })

    }
    console.log(`[Napcat] Sent message to ${id}: ${Array.isArray(message) ? message.map(segmentToString).join(" ") : message}`)
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

export { atMe, getId, reply, eventToString, formatGroupInfo }