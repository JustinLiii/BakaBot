import { describe, test, expect, beforeEach } from "bun:test";
import { StreamBuffer } from "../src/utils/stream_buffer";

describe("StreamBuffer", () => {
    let segments: string[];
    let buffer: StreamBuffer;
    
    beforeEach(() => {
        segments = [];
        buffer = new StreamBuffer(async (seg) => {
            segments.push(seg);
        });
    });
    
    test("should accumulate text and send on double newline", async () => {
        buffer.append("Hello");
        buffer.append(" World\n\n");
        buffer.append("Second");
        buffer.append(" message\n\nThird");
        
        await buffer.flush();
        
        expect(segments).toHaveLength(3);
        expect(segments[0]).toBe("Hello World");
        expect(segments[1]).toBe("Second message");
        expect(segments[2]).toBe("Third");
    });
    
    test("should handle empty segments", async () => {
        buffer.append("\n\n\n\n");
        buffer.append("Real content\n\n");
        
        await buffer.flush();
        
        expect(segments).toHaveLength(1);
        expect(segments[0]).toBe("Real content");
    });
    
    test("should handle multiple newlines in one append", async () => {
        buffer.append("First line\n\nSecond line\n\nThird line");
        
        await buffer.flush();
        
        expect(segments).toHaveLength(3);
        expect(segments[0]).toBe("First line");
        expect(segments[1]).toBe("Second line");
        expect(segments[2]).toBe("Third line");
    });
    
    test("should handle no newlines", async () => {
        buffer.append("This is a single line without newlines");
        
        await buffer.flush();
        
        expect(segments).toHaveLength(1);
        expect(segments[0]).toBe("This is a single line without newlines");
    });
    
    test("should handle error in onSegment callback", async () => {
        let errorCaught = false;
        const errorBuffer = new StreamBuffer(
            async () => {
                throw new Error("Test error");
            },
            (error) => {
                errorCaught = true;
                expect(error.message).toBe("Test error");
            }
        );
        
        errorBuffer.append("Test\n\n");
        await errorBuffer.flush();
        
        expect(errorCaught).toBe(true);
    });
    
    test("getBuffer should return current buffer content", () => {
        buffer.append("Partial ");
        expect(buffer.getBuffer()).toBe("Partial ");
        
        buffer.append("content");
        expect(buffer.getBuffer()).toBe("Partial content");
        
        buffer.append("\n\n");
        expect(buffer.getBuffer()).toBe("");
    });
    
    test("clear should empty the buffer", () => {
        buffer.append("Some content");
        expect(buffer.getBuffer()).toBe("Some content");
        
        buffer.clear();
        expect(buffer.getBuffer()).toBe("");
    });
});
