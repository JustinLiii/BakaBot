import { describe, test, expect, beforeEach, mock } from "bun:test";
import { StreamBuffer } from "../src/utils/stream_buffer";

describe("Streaming Integration Tests", () => {
    test("should simulate real message flow with multiple paragraphs", async () => {
        const segments: string[] = [];
        const buffer = new StreamBuffer(async (seg) => segments.push(seg));
        
        // 模拟真实的流式输出（分段到达）
        const mockStream = [
            "Hello everyone,\n\n",
            "Today I want to talk about AI agents.\n\n",
            "They are very useful for automation.\n\n",
            "Let me show you some examples."
        ];
        
        for (const chunk of mockStream) {
            buffer.append(chunk);
        }
        
        await buffer.flush();
        
        expect(segments).toHaveLength(4);
        expect(segments[0]).toBe("Hello everyone,");
        expect(segments[1]).toBe("Today I want to talk about AI agents.");
        expect(segments[2]).toBe("They are very useful for automation.");
        expect(segments[3]).toBe("Let me show you some examples.");
    });
    
    test("should handle mixed newline patterns", async () => {
        const segments: string[] = [];
        const buffer = new StreamBuffer(async (seg) => segments.push(seg));
        
        // 混合换行模式
        buffer.append("First paragraph.\n\nSecond");
        buffer.append(" paragraph continues.\n\n");
        buffer.append("Third paragraph.\n\n");
        
        await buffer.flush();
        
        expect(segments).toHaveLength(3);
        expect(segments[0]).toBe("First paragraph.");
        expect(segments[1]).toBe("Second paragraph continues.");
        expect(segments[2]).toBe("Third paragraph.");
    });
    
    test("should handle edge cases", async () => {
        const segments: string[] = [];
        const buffer = new StreamBuffer(async (seg) => segments.push(seg));
        
        // 边缘情况
        buffer.append("");  // 空字符串
        buffer.append("\n\n");  // 只有换行
        buffer.append("   \n\n   ");  // 空白字符
        buffer.append("Real content\n\n");
        
        await buffer.flush();
        
        expect(segments).toHaveLength(1);
        expect(segments[0]).toBe("Real content");
    });
    
    test("should handle error in callback gracefully", async () => {
        let errorCount = 0;
        const buffer = new StreamBuffer(
            async () => {
                throw new Error("Network error");
            },
            (error) => {
                errorCount++;
                expect(error.message).toBe("Network error");
            }
        );
        
        buffer.append("Test message\n\n");
        await buffer.flush();
        
        expect(errorCount).toBe(1);
    });
});
