import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { GroupMessage, PrivateFriendMessage, PrivateGroupMessage, NCWebsocket } from "node-napcat-ts";

import { buildAgent, type BakaAgent } from "./agent";
import { formatGroupInfo, formatGroupMemberList, groupPrompt, privatePrompt, eventToString } from "./prompts/napcat_templates";
import { triggered, get_text_content } from "./utils/agent_utils";
import { atMe, getId, reply } from "./utils/napcat_utils";
import { system_prompt } from "./prompts/sys";

type PrivateMsgHandler = (event: PrivateFriendMessage | PrivateGroupMessage, agent: BakaAgent) => Promise<void>;
type GroupMsgHandler = (event: GroupMessage, agent: BakaAgent) => Promise<void>;

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

    private registerMsgHandler(napcat: NCWebsocket, agent: BakaAgent, sessionId: string) {

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
                        await reply(msg, sessionId, napcat);
                    }
                }
            } else {
                for (const msg of msgs) {
                    await reply(msg, sessionId, napcat);
                }
            }
        })
    }

    private async constructAgent(event: GroupMessage | PrivateFriendMessage | PrivateGroupMessage, napcat: NCWebsocket): Promise<BakaAgent> {
        let sys_prompt: string = system_prompt;
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

        return await buildAgent({
            systemPrompt: sys_prompt,
        });
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
