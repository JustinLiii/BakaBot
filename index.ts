import { agent } from "./agent";
import { napcat } from "./Napcat";
import { Structs } from 'node-napcat-ts'

napcat.on('message.private', async (context) => {
    let msg = null
    for (const message of context.message) {
        if (message.type === 'text') {
            msg = message
            break
        }
    }

    if (!msg) return

    const text = msg.data.text;
    
    const unsubscribe = agent.subscribe((event) => {
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_end") {
            // 使用napcat的正确发送方法
            napcat.send_msg({
                user_id: context.sender.user_id,
                message: [Structs.text(event.assistantMessageEvent.content)]
            })
            unsubscribe();
        }
    });

    // 传入用户消息内容
    await agent.prompt(text);
});

napcat.on("message.group", async (context) => { 
    let atMe = null
    let lastMessage: { type: 'text'; data: { text: string } } | null = null
    for (const message of context.message) {
        if (message.type === 'at' &&  Number(message.data.qq) ===context.self_id) {
            atMe = context.sender
        }
        if (message.type === 'text') {
            lastMessage = message
        }
    }
    if (!atMe) return
    
    // 安全地访问文本内容
    let text = atMe.nickname
    if (lastMessage) {
        text = text + "说：\n" + lastMessage.data.text;
    } else {
        text = text + "@了一下你"
    }
    
    const unsubscribe = agent.subscribe((event) => {
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_end") {
            // 使用napcat的正确发送方法
            napcat.send_group_msg({
                group_id: context.group_id,
                message: [Structs.reply(context.message_id), Structs.at(atMe.user_id), Structs.text(event.assistantMessageEvent.content)]
            })
            unsubscribe();
        }
    });

    // 传入用户消息内容
    await agent.prompt(text);
});

napcat.connect();
