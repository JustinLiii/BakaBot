# 流式消息发送功能文档

## 概述

流式消息发送功能允许BakaBot在AI生成消息时实时分段发送，而不是等待所有内容生成完毕再一次性发送。这提供了更好的用户体验，用户可以看到消息逐步生成的过程。

## 架构设计

### 核心组件

#### 1. StreamBuffer 类
位于 `src/utils/stream_buffer.ts`，负责：
- 累积文本增量
- 检测 `\n\n` 分隔符
- 分段发送消息
- 错误处理

#### 2. MessageUpdateHandler
位于 `src/bakabot.ts:registerMsgHandler`，负责：
- 监听 `message_update` 事件
- 捕获 `text_delta` 增量
- 调用 StreamBuffer 处理文本

#### 3. SegmentSender
内嵌在 StreamBuffer 中，负责：
- 发送分段消息
- 处理群聊和私聊的不同发送方式

### 事件流

```
用户发送消息
    ↓
BakaBot.onMsg() 处理消息
    ↓
agent.continue() 触发AI生成
    ↓
message_start 事件（开始生成）
    ↓
message_update + text_delta 事件（文本增量到达）
    ↓
StreamBuffer.append() 累积文本
    ↓
检测到 \n\n → 发送前一段
    ↓
message_end 事件（生成结束）
    ↓
StreamBuffer.flush() 发送剩余内容
```

## 实现细节

### 文本分段逻辑

```typescript
// 核心分段逻辑
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
```

### 错误处理

```typescript
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
```

## 向后兼容性

### 后备机制
如果流式事件不触发或出现问题，系统会自动回退到原有的批量处理逻辑：

```typescript
// 原有的批量处理逻辑作为后备
if (event.type === "message_end" && event.message.role === "assistant") {
    const content = get_text_content(event.message);
    if (content.length > 0) {
        const msgs = content.split("\n\n").filter(m => m.trim().length > 0);
        for (const msg of msgs) {
            // 发送消息...
        }
    }
}
```

## 测试策略

### 单元测试
- `tests/stream_buffer.test.ts`：测试 StreamBuffer 类的各种场景
- 包括正常流程、边缘情况、错误处理

### 集成测试
- `tests/streaming_integration.test.ts`：模拟真实的消息流
- 测试多个段落、混合换行模式等

## 性能考虑

1. **内存使用**：StreamBuffer 只保留当前未发送的文本，内存占用小
2. **网络延迟**：分段发送可以减少用户等待时间
3. **错误恢复**：单个分段发送失败不影响其他分段

## 已知限制

1. **依赖事件**：需要 `message_update` 和 `text_delta` 事件支持
2. **分隔符**：目前仅支持 `\n\n` 作为段落分隔符
3. **短消息**：非常短的消息可能不会立即发送

## 未来优化

1. **智能分段**：基于语义而非仅 `\n\n`
2. **速率限制**：控制消息发送频率
3. **进度指示**：显示"正在输入..."状态
4. **撤回功能**：支持撤回最后一条消息

## 相关文件

- `src/utils/stream_buffer.ts`：核心缓冲区实现
- `src/bakabot.ts`：消息处理器集成
- `tests/stream_buffer.test.ts`：单元测试
- `tests/streaming_integration.test.ts`：集成测试
