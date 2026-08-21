import type { SendMessageSegment, GroupMessage, PrivateFriendMessage, PrivateGroupMessage, Receive } from "node-napcat-ts";
import { formatEventTime } from "../qqbot/utils";
import faceConfig from "../utils/face_config.json" with { type: "json" }; // from (https://github.com/LLOneBot/LuckyLilliaBot/blob/9a6c4e9486c352e58708dc4f8215faee389d0b06/src/ntqqapi/helper/face_config.json)
import { NCWebsocket } from 'node-napcat-ts';
import { type WSSendReturn } from "node-napcat-ts";

type FaceConfigItem = {
    QSid: string;
    QDes?: string;
    IQLid?: string;
    AQLid?: string;
    EMCode?: string;
};

const faceDescriptionMap = new Map<string, string>();
for (const face of faceConfig.sysface as FaceConfigItem[]) {
    const description = face.QDes ?? "";
    for (const id of [face.QSid, face.IQLid, face.AQLid, face.EMCode]) {
        if (id !== undefined) {
            faceDescriptionMap.set(id, description);
        }
    }
}

function getFaceDescription(id: number | string): string | undefined {
    return faceDescriptionMap.get(String(id));
}

const pokeNameMap = new Map<string, string>([
    ["1:-1", "戳一戳"],
    ["2:-1", "比心"],
    ["3:-1", "点赞"],
    ["4:-1", "心碎"],
    ["5:-1", "666"],
    ["6:-1", "放大招"],
    ["126:2011", "宝贝球"],
    ["126:2007", "玫瑰花"],
    ["126:2006", "召唤术"],
    ["126:2009", "让你皮"],
    ["126:2005", "结印"],
    ["126:2004", "手雷"],
    ["126:2003", "勾引"],
    ["126:2001", "抓一下"],
    ["126:2002", "敲门"],
]);

function getPokeName(type: number | string, id: number | string): string | undefined {
    return pokeNameMap.get(`${type}:${id}`);
}

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

async function segmentsToString(segments: SendMessageSegment[] | Receive[keyof Receive][], napcat: NCWebsocket): Promise<string> {
    return (await Promise.all(
        segments.map(
            (segment) => segmentToString(segment, napcat)
        )
    )).join(" ")
}

async function segmentToString(segment: SendMessageSegment | Receive[keyof Receive], napcat: NCWebsocket): Promise<string> {
    switch (segment.type) {
        case "text":
            return segment.data.text;
        case "image":
            return "url" in segment.data
                ? `![${segment.data.file}](${segment.data.url})`
                : `[图片：${segment.data.file}]`;
        case "at":
            return `[@${segment.data.qq}]`;
        case "face":
            return `[表情:${getFaceDescription(segment.data.id) ?? segment.data.id}]`;
        case "mface":
            return `[表情:${getFaceDescription(segment.data.emoji_id) ?? segment.data.emoji_id}]`;
        case "contact":
            return `[联系人:${segment.data.id}]`;
        case "file":
            return `[文件:${segment.data.file}]`;
        case "forward":
            async function fmtEvent(event: WSSendReturn["get_msg"]) {
                const nickname = event.sender.nickname;
                const user_id = event.sender.user_id;
                const content = await segmentsToString(event.message, napcat);
                return `${nickname}(${user_id}): ${content}`;
            }

            try {
                const events = (await napcat.get_forward_msg({"message_id": segment.data.id}))
                    .messages;
                const forwardedMsg = (await Promise.all(
                    events.map(fmtEvent)
                )).join("\n");
                return `[转发]\n${forwardedMsg}`;
            } catch (e) {
                if (e instanceof Error) {
                    console.warn(`获取转发消息详情时出错 ${e.message}`);
                    console.warn(e.stack);
                    return `[获取转发消息详情时出错 ${e.message}]`;
                } else {
                    console.warn(`获取转发消息详情时出错，未知错误：${e}`);
                    return `[获取转发消息详情时出错，未知错误：${e}]`;
                }
            }
        case "node":
            if ("id" in segment.data) {
                // 带 id 的 node只作为发送消息
                return "[未知消息类型]";
            } else {
                const nickname = segment.data.nickname ?? "";
                const user_id = segment.data.user_id ?? "";
                const content = await segmentsToString(segment.data.content, napcat);
                return `${nickname}(${user_id}): ${content}`
            }
        case "json":
            return `${segment.data.data}`;
        case "markdown":
            return `${segment.data.content}`;
        case "music":
            if ("title" in segment.data) {
                return `[音乐:${segment.data.title}]`;
            } else {
                return "[音乐]";
            }
        case "record":
            return "[语音]";
        case "video":
            return "[视频]";
        case "reply":
            const reply_msg_id = Number(segment.data.id);
            try {
                const msg_segments = (await napcat.get_msg({"message_id": reply_msg_id}))
                    .message;
                return `[回复]${await segmentsToString(msg_segments, napcat)}`;
            } catch (e) {
                if (e instanceof Error) {
                    console.warn(`获取回复消息详情时出错 ${e.message}`);
                    console.warn(e.stack);
                    return `[获取回复消息详情时出错 ${e.message}]`;
                } else {
                    console.warn(`获取回复消息详情时出错，未知错误：${e}`);
                    return `[获取回复消息详情时出错，未知错误：${e}]`;
                }
            }
        case "dice":
            return `[掷骰子]${segment.data.value}`;
        case "rps":
            return `[猜拳]${segment.data.result}`;
        case "poke":
            return `[戳了戳你:${getPokeName(segment.data.type, segment.data.id) ?? `${segment.data.type}:${segment.data.id}`}]`;
        default:
            return "[未知消息类型]";
    }
}

async function eventToString(event: GroupMessage | PrivateFriendMessage | PrivateGroupMessage, napcat: NCWebsocket): Promise<string> {
    let msg = "";
    if (event.message_type === "group") {
        msg += `[用户 ${event.sender.nickname} (${event.sender.user_id})](${formatEventTime(event.time)}):\n`;
    } else {
        msg += `(${formatEventTime(event.time)}):\n`;
    }
    return msg + (await segmentsToString(event.message, napcat));
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


export { formatGroupInfo, formatGroupMemberList, segmentToString, eventToString, groupPrompt, privatePrompt, groupMessageWithHistory, getFaceDescription, getPokeName };
