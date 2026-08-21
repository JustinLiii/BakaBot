import type {
    GroupMessage,
    PrivateFriendMessage,
    PrivateGroupMessage,
    SendMessageSegment,
    NCWebsocket
} from "node-napcat-ts";
import { Structs } from "node-napcat-ts";

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
    console.log(`[Napcat] Sent message to ${sessionId}: ${Array.isArray(message) ? message.map((msg) => `${msg.type}:${"text" in msg.data ? msg.data.text: ""}`).join(" ") : message}`)
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

/**
 * 将 NapCat/OneBot 的 event.time（Unix 秒）格式化为指定时区的本地时间。
 */
function formatEventTime(
  time: number,
  timeZone = "Asia/Shanghai",
): string {
  if (!Number.isFinite(time)) {
    throw new TypeError("time 必须是有效的 Unix 时间戳（秒）");
  }

  // event.time 是秒，Date 构造函数需要毫秒。
  const date = new Date(time * 1000);

  if (Number.isNaN(date.getTime())) {
    throw new RangeError("event.time 超出 Date 支持的范围");
  }

  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export { atMe, getId, reply, formatEventTime }