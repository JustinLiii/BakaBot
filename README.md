# bakabot

To install dependencies:

```bash
bun install
```

To run:

```bash
# 第一次运行前请先拉取镜像，否则 Agent 第一次执行 Bash 指令时会因为拉取镜像耗时过长而导致超时失败
docker pull juztinlii/bakabot-sandbox
bun run index.ts
```

This project was created using `bun init` in bun v1.3.8. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## 🚀 流式消息发送功能

BakaBot现在支持流式消息发送！当AI生成消息时，会实时分段发送，提供更好的用户体验。

### 特性：
- **实时消息分段**：检测到 `\n\n` 时自动发送前一段
- **错误处理**：网络错误时自动捕获并记录日志
- **向后兼容**：保留原有的批量处理逻辑作为后备
- **智能缓冲**：累积文本并智能分段发送

### 工作原理：
1. AI开始生成响应 → `message_start` 事件
2. 文本增量到达 → `message_update` + `text_delta` 事件
3. StreamBuffer累积并检测 `\n\n`
4. 发送完整段落
5. 消息结束 → `message_end` 事件
6. 发送剩余内容

### 核心组件：
- **StreamBuffer** (`src/utils/stream_buffer.ts`)：文本缓冲区，负责累积和分段
- **MessageUpdateHandler** (`src/bakabot.ts:registerMsgHandler`)：监听流式事件
- **SegmentSender**：发送分段消息

### 测试覆盖：
- 单元测试：`tests/stream_buffer.test.ts`
- 集成测试：`tests/streaming_integration.test.ts`
