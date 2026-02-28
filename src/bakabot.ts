import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { GroupMessage, PrivateFriendMessage, PrivateGroupMessage, NCWebsocket } from "node-napcat-ts";

import { buildAgent, type BakaAgent } from "./agent";
import { formatGroupInfo, formatGroupMemberList, groupPrompt, privatePrompt, eventToString } from "./prompts/napcat_templates";
import { triggered, get_text_content } from "./utils/agent_utils";
import { atMe, getId, reply } from "./utils/napcat_utils";
import { system_prompt } from "./prompts/sys";
import { Structs } from "node-napcat-ts";
import { StreamBuffer } from "./utils/stream_buffer";

type PrivateMsgHandler = (event: PrivateFriendMessage | PrivateGroupMessage, agent: BakaAgent) => Promise<void>;
type GroupMsgHandler = (event: GroupMessage, agent: BakaAgent) => Promise<void>;

class BakaBot {

    agentDict: Map<string, {agent: BakaAgent | null, pending: (GroupMessage | PrivateFriendMessage | PrivateGroupMessage)[]}> = new Map();

    processPrivateMsg: PrivateMsgHandler[] = [];
    processGroupMsg: GroupMsgHandler[] = [];

    selfId?: string;

    groupContextLimit = 20;

    // 状态缓存
    private typingStates = new Map<string, boolean>();
    // 超时机制
    private typingTimeouts = new Map<string, NodeJS.Timeout>();

    constructor(selfId?: string) { 
        this.selfId = selfId;
        this.processGroupMsg = [
            this.clear.bind(this),
            this.stop.bind(this),
            this.replyGroupMsg.bind(this)
        ]

        this.processPrivateMsg = [
            this.clear.bind(this),
            this.stop.bind(this),
            this.replyPrivateMsg.bind(this)
        ]
        process.on('SIGINT', async  () => {
            for (const [id, session] of this.agentDict) {
                console.log(`Saving memories for session ${id}`);
                if (session.agent) {
                    await session.agent.RememberAll();
                }
            }
            process.exit();
        });
    }
    
    private registerMsgHandler(napcat: NCWebsocket, agent: BakaAgent, sessionId: string) {
        // 为每个会话创建流式缓冲区
        const streamBuffer = new StreamBuffer(async (segment: string) => {
            if (agent.toBeReplied) {
                // @ts-ignore
                await agent.toBeReplied.quick_action(segment, true);
                agent.toBeReplied = null;
            } else {
                await reply(segment, sessionId, napcat);
            }
        }, (error) => {
            console.error(`[Stream] Error sending segment for session ${sessionId}:`, error);
        });
        
        // 监听事件
        agent.subscribe(async (event) => {
            // 处理流式文本增量
            if (event.type === "message_update" && 
                event.assistantMessageEvent?.type === "text_delta") {
                
                const delta = event.assistantMessageEvent.delta;
                streamBuffer.append(delta);
            }
            
            // 处理"正在输入"状态
            if (event.type === "message_start" && event.message.role === "assistant") {
                await this.startTypingWithTimeout(sessionId, napcat);
            }
            
            if (event.type === "message_end" && event.message.role === "assistant") {
                await this.stopTypingWithCleanup(sessionId, napcat);
                await streamBuffer.flush();
            }
        });
    }

    private async startTyping(sessionId: string, napcat: NCWebsocket): Promise<void> {
        // 只处理私聊（sessionId不以"g"开头）
        if (sessionId.startsWith("g")) {
            console.log("[Typing] 群聊不支持正在输入状态");
            return;
        }
        
        try {
            const userId = sessionId; // 私聊的sessionId就是userId
            await napcat.set_input_status({
                user_id: userId,
                event_type: 1  // 1 = 正在输入
            });
            console.log(`[Typing] 开始显示正在输入状态 for ${userId}`);
            this.typingStates.set(sessionId, true);
        } catch (error) {
            console.error("[Typing] 设置输入状态失败:", error);
            // 静默失败，不影响正常消息发送
        }
    }

    private async stopTyping(sessionId: string, napcat: NCWebsocket): Promise<void> {
        if (sessionId.startsWith("g")) return;
        
        try {
            const userId = sessionId;
            await napcat.set_input_status({
                user_id: userId,
                event_type: 0  // 0 = 正在说话（或停止状态）
            });
            console.log(`[Typing] 结束正在输入状态 for ${userId}`);
            this.typingStates.set(sessionId, false);
        } catch (error) {
            console.error("[Typing] 停止输入状态失败:", error);
        }
    }

    private async startTypingWithTimeout(sessionId: string, napcat: NCWebsocket): Promise<void> {
        // 检查状态缓存，避免重复调用
        if (this.typingStates.get(sessionId) === true) {
            console.log(`[Typing] 状态已为true，跳过重复调用 for ${sessionId}`);
            return;
        }
        
        // 清除现有超时
        if (this.typingTimeouts.has(sessionId)) {
            clearTimeout(this.typingTimeouts.get(sessionId));
            this.typingTimeouts.delete(sessionId);
        }
        
        // 设置新超时（30秒后自动停止）
        const timeout = setTimeout(() => {
            console.log(`[Typing] 超时自动停止 for ${sessionId}`);
            this.stopTyping(sessionId, napcat);
            this.typingTimeouts.delete(sessionId);
        }, 30000);
        
        this.typingTimeouts.set(sessionId, timeout);
        
        // 调用API
        await this.startTyping(sessionId, napcat);
    }

    private async stopTypingWithCleanup(sessionId: string, napcat: NCWebsocket): Promise<void> {
        // 清除超时
        if (this.typingTimeouts.has(sessionId)) {
            clearTimeout(this.typingTimeouts.get(sessionId));
            this.typingTimeouts.delete(sessionId);
        }
        
        // 停止输入状态
        await this.stopTyping(sessionId, napcat);
    }

    private async constructAgent(event: GroupMessage | PrivateFriendMessage | PrivateGroupMessage, napcat: NCWebsocket): Promise<BakaAgent> {
        let sys_prompt: string = system_prompt;
        const sessionId = getId(event);
        if (event.message_type === "group") {
            const group_info_str = formatGroupInfo(await napcat.get_group_info({ group_id: event.group_id }))
            const group_member_list_str = formatGroupMemberList(await napcat.get_group_member_list({ group_id: event.group_id }))
            sys_prompt += groupPrompt(group_info_str, group_member_list_str);
        } else if (event.message_type === "private") {
            if (event.sub_type === "friend") {
                const userInfo = {
                    "user_id": event.sender.user_id,
                    "nickname": event.sender.nickname,
                    "remark": event.sender.card
                }
                sys_prompt += privatePrompt(userInfo);
            } else { // sub_type === "group"
                const userInfo = {
                    "user_id": event.sender.user_id,
                    "nickname": event.sender.nickname,
                }
                sys_prompt += privatePrompt(userInfo);
            }
        }

        return await buildAgent(sessionId, {
            systemPrompt: sys_prompt,
        });
    }

    async onMsg(event: GroupMessage | PrivateFriendMessage | PrivateGroupMessage, napcat: NCWebsocket): Promise<void> {
        const msg = eventToString(event);
        const id = getId(event);

        let session = this.agentDict.get(id);
        if (!session) {
            // build agent for new session
            session = { agent: null, pending: [] };
            this.agentDict.set(id, session);
            session.agent = await this.constructAgent(event, napcat);
            this.registerMsgHandler(napcat, session.agent, id);
            console.log("[Bot] Agent created for " + id);
        } else if (!session.agent) {
            // agent is still being built, queue the message
            session.pending.push(event);
            console.log("[Bot] Pending message for " + id);
            return;
        }

        session.pending.push(event);

        const agent = session.agent!;

        while (session.pending.length > 0) {
            const thisEvent = session.pending.shift()!;
            if (thisEvent.message_type === "group") {
                console.log("[Bot] Processing group message for " + id)
                for (const handle of this.processGroupMsg) await handle(thisEvent, agent);
            } else if (thisEvent.message_type === "private") {
                console.log("[Bot] Processing private message for " + id)
                for (const handle of this.processPrivateMsg) await handle(thisEvent, agent);
            }
        }
    }

    // ---------------
    // Slash Commands
    // ---------------
    async clear(event: GroupMessage | PrivateFriendMessage | PrivateGroupMessage, agent: BakaAgent) {
        if (event.raw_message === "/clear") {
            agent.clear();
            await reply("已清除历史记录", getId(event), napcat);
        }
    }

    async stop(event: GroupMessage | PrivateFriendMessage | PrivateGroupMessage, agent: BakaAgent) {
        if (event.raw_message === "/stop") {
            agent.stop();
            await reply("已停止当前任务", getId(event), napcat);
        }
    }

    // ---------------
    // Reply Handlers
    // ---------------
    async replyGroupMsg(event: GroupMessage, agent: BakaAgent) {
        if (triggered(event, this.selfId)) {
            agent.addMessage({ role: 'user', content: event.raw_message, timestamp: Date.now() });
            agent.continue();
        } else {
            agent.GroupfollowUp(event);
        }
    }

    async replyPrivateMsg(event: PrivateFriendMessage | PrivateGroupMessage, agent: BakaAgent) {
        agent.addMessage({ role: 'user', content: event.raw_message, timestamp: Date.now() });
        agent.continue();
    }
}

export { BakaBot };
