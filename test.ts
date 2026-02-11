import { RagService } from "./src/utils/rag_service";
import type { AgentMessage } from "@mariozechner/pi-agent-core";

const rag = new RagService("114514");

const msg1 = {role: "user", content: "hello world", timestamp: Date.now()} as AgentMessage;
const msg2 = {role: "user", content: "hello", timestamp: Date.now()} as AgentMessage;
const msg3 = {role: "user", content: "world", timestamp: Date.now()} as AgentMessage;
const msg4 = {role: "user", content: "damn you", timestamp: Date.now()} as AgentMessage;

await rag.add(msg1);
await rag.add(msg2);
await rag.add(msg3);
await rag.add(msg4);

const result = await rag.search("hello")

console.log(result.map((r)=>`${r.role}: ${r.content}`).join("\n"))

// import * as lancedb from "@lancedb/lancedb";

// const db = await lancedb.connect("data");

// try {
//     await db.openTable("Hello");
// } catch (e) {
//     if (e instanceof Error && e.message.includes(`Table '${"Hello"}' was not found`)) {
//         console.log("should create table")
//     } else {
//         console.log(e.message)
//         throw e;
//     }
// }
