import type { SendMessageSegment, GroupMessage, PrivateFriendMessage, PrivateGroupMessage, Receive } from "node-napcat-ts";

function formatGroupInfo(
    groupInfo: {group_all_shut: number; group_remark: string; group_id: number; group_name: string; member_count: number; max_member_count: number;}, 
    ): string {
    return `
群名: ${groupInfo.group_name} (ID: ${groupInfo.group_id})
群备注: ${groupInfo.group_remark || "无"}
成员数: ${groupInfo.member_count}\n`;
}

function roleString(role: "owner" | "admin" | "member"): string {
    switch (role) {
        case "owner":
            return "[群主]";
        case "admin":
            return "[管理员]";
        default:
            return "";
    }
}

function formatGroupMemberList(
    memberInfo: {
        group_id: number;
        user_id: number;
        nickname: string;
        card: string;
        sex: "male" | "female" | "unknown";
        age: number;
        area: string;
        level: string;
        qq_level: number;
        join_time: number;
        last_sent_time: number;
        title_expire_time: number;
        unfriendly: boolean;
        card_changeable: boolean;
        is_robot: boolean;
        shut_up_timestamp: number;
        role: "owner" | "admin" | "member";
        title: string;
    }[]
): string {
    let str = `\n成员列表: [昵称 (id) - 群内昵称]\n`;
    str += memberInfo.map((m) => `${m.nickname} (${m.user_id}) - ${m.card} ${roleString(m.role)}`).join("\n");
    str += "\n";
    return str
}

function segmentToString(segment: SendMessageSegment | Receive[keyof Receive]): string {
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
        msg += `[用户 ${event.sender.nickname} (${event.sender.user_id})]:\n`;
    }
    return msg + event.message.map(segmentToString).join(" ");
}

function groupPrompt(
    formattedGroupInfo: string,
    formattedMemberList: string
): string {
    return `你处于一个群聊中，User信息可能来自不同的群成员

如果有，尽量使用对应的群内昵称称呼用户

群信息：
${formattedGroupInfo}

群成员列表：
${formattedMemberList}`
}

function privatePrompt(
    userInfo: {
        user_id: number;
        nickname: string;
        remark?: string;
    }
): string {
    return `与你对话的用户信息如下：
昵称: ${userInfo.nickname}
备注: ${userInfo.remark || "无"}
ID: ${userInfo.user_id}
`
}

function groupMessageWithHistory(
    msg: string,
    history: string[]
): string {
    return `近期群聊记录：
${history.join("\n")}

User:
${msg}
`
}


export { formatGroupInfo, formatGroupMemberList, segmentToString, eventToString, groupPrompt, privatePrompt, groupMessageWithHistory };