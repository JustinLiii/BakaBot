import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { GroupMessage, PrivateFriendMessage, PrivateGroupMessage } from "node-napcat-ts";

import { buildAgent } from "./src/agent";
import type { BakaAgent } from "./src/agent";
import { napcat } from "./src/napcat";
import { triggered } from "./src/utils/agent_utils";
import { atMe, getId } from "./src/utils/napcat_utils";

type PrivateMsgHandler = (event: PrivateFriendMessage | PrivateGroupMessage, agent: BakaAgent) => Promise<void>;
type GroupMsgHandler = (event: GroupMessage, agent: BakaAgent) => Promise<void>;

class Bakabot {

    agentDict: Map<string, {agent: BakaAgent | null, pending: (GroupMessage | PrivateFriendMessage | PrivateGroupMessage)[]}> = new Map();

    processPrivateMsg: PrivateMsgHandler[] = [];
    processGroupMsg: GroupMsgHandler[] = [];

    groupContextLimit = 20;

    constructor() { 
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

    async onMsg(event: GroupMessage | PrivateFriendMessage | PrivateGroupMessage) {
        console.log(event.raw_message);
        const id = getId(event);
        let session = this.agentDict.get(id);
        if (!session) {
            // build agent for new session
            session = { agent: null, pending: [] };
            this.agentDict.set(id, session);
            session.agent = await buildAgent(id, napcat);
            console.log("Agent created for " + id);
        } else if (!session.agent) {
            // agent is still being built, queue the message
            session.pending.push(event);
            console.log("Pending message for " + id);
            return;
        }

        session.pending.push(event);

        console.log("Processing message for " + id)

        const agent = session.agent!;

        while (session.pending.length > 0) {
            const thisEvent = session.pending.pop()!;
            if (thisEvent.message_type === "group") {
                console.log("Processing group message for " + id)
                for (const handle of this.processGroupMsg) await handle(thisEvent, agent);
            } else if (thisEvent.message_type === "private") {
                console.log("Processing private message for " + id)
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
        const text = context.raw_message
        console.log("User: " + text);
        try {
            await agent.prompt(text);
        } catch (e) {
            if (!(e instanceof Error)) throw e;
            if (!e.message.includes("Agent is already processing a prompt.")) throw e;
            console.log("Agent busy, sending steer");
            agent.steer({role: "user", content: text, timestamp: new Date().getTime() });
        }
    }

    async replyGroupMsg(context: GroupMessage, agent: BakaAgent) {
        // console.log("Processing:"+ context.raw_message)
        if (context.sender.user_id == context.self_id) return;
        console.log("Processing:"+ context.raw_message)
        const msg: AgentMessage = {
            role: "user",
            content: context.raw_message,
            timestamp: new Date().getTime()
        }
        const at = atMe(context)
        if (!at && !(await triggered(context.raw_message, agent))) {
            if (agent.state.messages.length + 1 > this.groupContextLimit) {
                agent.state.messages = agent.state.messages.slice(-(this.groupContextLimit - 1))
            }
            agent.state.messages.push(msg)
            return 
        }
        
        console.log("User: " + context.raw_message);
        try {
            await agent.prompt(msg);
        } catch (e) {
            if (!(e instanceof Error)) throw e;
            if (!e.message.includes("Agent is already processing a prompt.")) throw e;
            console.log("Agent busy, sending group follow up");
            agent.GroupfollowUp(context);
        }
    }
}

const bot = new Bakabot();

napcat.on("message", bot.onMsg.bind(bot));

napcat.connect();
