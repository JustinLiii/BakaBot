import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { GroupMessage, PrivateFriendMessage, PrivateGroupMessage, NCWebsocket } from "node-napcat-ts";

import { buildAgent, type BakaAgent } from "./agent";
import { formatGroupInfo, formatGroupMemberList } from "./prompts/napcat_templates";
import { triggered, get_text_content } from "./utils/agent_utils";
import { atMe, getId, reply, eventToString } from "./utils/napcat_utils";

type PrivateMsgHandler = (event: PrivateFriendMessage | PrivateGroupMessage, agent: BakaAgent) => Promise<void>;
type GroupMsgHandler = (event: GroupMessage, agent: BakaAgent) => Promise<void>;

async function getGroupSessionMeta(group_id: number, napcat: NCWebsocket) {
    const groupInfoRaw = await napcat.get_group_info({group_id})
    const groupMemberList = await napcat.get_group_member_list({group_id})
    return formatGroupInfo(groupInfoRaw) + formatGroupMemberList(groupMemberList);
}

class BakaBot {

    agentDict: Map<string, {agent: BakaAgent | null, pending: (GroupMessage | PrivateFriendMessage | PrivateGroupMessage)[]}> = new Map();

    processPrivateMsg: PrivateMsgHandler[] = [];
    processGroupMsg: GroupMsgHandler[] = [];

    selfId?: string;

    groupContextLimit = 20;

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
    }

    registerMsgHandler(napcat: NCWebsocket, agent: BakaAgent) {
        if (!agent.extra || !agent.extra.chatId) throw new Error("Agent missing chatId in extra");
        const chatId = agent.extra.chatId;

        agent.subscribe(async (event) => {
            if (event.type !== "message_end" || event.message.role !== "assistant") return;
            const msg = get_text_content(event.message);

            if (msg.length === 0) return;

            // multi message sending
            const msgs = msg.split("\n\n").filter(m => m.trim().length > 0);
            if (agent.toBeReplied){
                for (const msg of msgs) {
                    if (agent.toBeReplied) {
                        await agent.toBeReplied.quick_action(msg, true); // this is the correct way to invoke quick action
                        agent.toBeReplied = null;
                    } else {
                        await reply(msg, chatId, napcat);
                    }
                }
            } else {
                for (const msg of msgs) {
                    await reply(msg, chatId, napcat);
                }
            }
        })
    }

    async onMsg(event: GroupMessage | PrivateFriendMessage | PrivateGroupMessage, napcat: NCWebsocket): Promise<void> {
        const msg = eventToString(event);
        const id = getId(event);
        console.log(`[Bot] Received message in ${id}: ${msg}`);

        // new seesion handling
        let session = this.agentDict.get(id);
        if (!session) {
            // build agent for new session
            session = { agent: null, pending: [] };
            this.agentDict.set(id, session);
            let groupInfo: string | undefined = undefined;
            let userInfo: string | undefined = undefined;
            if (event.message_type === "group") {
                
            } else if (event.message_type === "private") {
                const friendList = await napcat.get_friend_list();
                const friend = friendList.find(f => f.user_id === event.sender.user_id);
                if (friend) {
                    userInfo = `好友昵称：${friend.nickname}\n好友备注：${friend.remark}`;
                } else {
                    const stranger = await napcat.get_stranger_info({ user_id: event.sender.user_id });
                    userInfo = `用户昵称：${stranger.nickname}`;
                }
            }

            session.agent = await buildAgent({
                chatId: id,
                selfId: this.selfId ?? undefined,
                groupInfo: groupInfo,
                userInfo: userInfo
            });
            this.registerMsgHandler(napcat, session.agent);
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
            agent.clearMessages()
        }
    }

    async stop(event: GroupMessage | PrivateFriendMessage | PrivateGroupMessage, agent: BakaAgent) {
        if (event.raw_message === "/stop") {
            agent.abort()
        }
    }

    // ---------------
    // Msg process
    // ---------------
    async replyPrivateMsg(context: PrivateFriendMessage | PrivateGroupMessage, agent: BakaAgent) {
        const text = eventToString(context);
        console.log("User: " + text);
        try {
            await agent.prompt(text);
        } catch (e) {
            if (!(e instanceof Error)) throw e;
            if (!e.message.includes("Agent is already processing a prompt.")) throw e;
            console.log("[Bot] Agent busy, sending steer");
            agent.steer({role: "user", content: text, timestamp: new Date().getTime() });
        }
    }

    async replyGroupMsg(context: GroupMessage, agent: BakaAgent) {
        // console.log("Processing:"+ context.raw_message)
        if (context.sender.user_id == context.self_id) return;
        const text = eventToString(context);
        console.log("[Bot] Processing:"+ text)
        const msg: AgentMessage = {
            role: "user",
            content: text,
            timestamp: new Date().getTime()
        }
        const at = atMe(context)
        if (!at && !(await triggered(text, agent))) {
            if (agent.state.messages.length + 1 > this.groupContextLimit) {
                agent.state.messages = agent.state.messages.slice(-(this.groupContextLimit - 1))
            }
            agent.state.messages.push(msg)
            return 
        }
        
        console.log("[Bot] Calling agent");
        try {
            await agent.prompt(msg);
        } catch (e) {
            if (!(e instanceof Error)) throw e;
            if (!e.message.includes("Agent is already processing a prompt.")) throw e;
            console.log("[Bot] Agent busy, sending group follow up");
            agent.GroupfollowUp(context);
        }
    }
}

export { BakaBot }
