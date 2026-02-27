/**
 * 流式消息缓冲区类
 * 负责累积文本增量，检测 \n\n 分隔符，分段发送消息
 */
export class StreamBuffer {
    private buffer: string = "";
    private onSegment: (segment: string) => Promise<void>;
    private errorHandler?: (error: Error) => void;
    
    constructor(
        onSegment: (segment: string) => Promise<void>,
        errorHandler?: (error: Error) => void
    ) {
        this.onSegment = onSegment;
        this.errorHandler = errorHandler;
    }
    
    /**
     * 添加文本增量到缓冲区
     * @param delta 文本增量
     */
    append(delta: string): void {
        this.buffer += delta;
        this.processBuffer();
    }
    
    /**
     * 处理缓冲区，检测 \n\n 并发送完整段落
     */
    private processBuffer(): void {
        while (true) {
            const index = this.buffer.indexOf("\n\n");
            if (index === -1) break;
            
            const segment = this.buffer.substring(0, index).trim();
            if (segment.length > 0) {
                this.safeSend(segment);
            }
            
            this.buffer = this.buffer.substring(index + 2);
        }
    }
    
    /**
     * 安全发送消息段，处理错误
     * @param segment 消息段
     */
    private async safeSend(segment: string): Promise<void> {
        try {
            await this.onSegment(segment);
        } catch (error) {
            if (this.errorHandler) {
                this.errorHandler(error as Error);
            } else {
                console.error("[StreamBuffer] Failed to send segment:", error);
            }
        }
    }
    
    /**
     * 发送缓冲区中剩余的内容
     */
    async flush(): Promise<void> {
        const remaining = this.buffer.trim();
        if (remaining.length > 0) {
            await this.safeSend(remaining);
        }
        this.buffer = "";
    }
    
    /**
     * 获取当前缓冲区内容
     */
    getBuffer(): string {
        return this.buffer;
    }
    
    /**
     * 清空缓冲区
     */
    clear(): void {
        this.buffer = "";
    }
}
