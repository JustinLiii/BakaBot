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

## 🔌 MCP 配置

BakaBot 会在创建会话 Agent 时，自动读取该会话目录下的 `mcp.json` 并注册 MCP tools：

`data/sessions/<sessionId>/mcp.json`

`mcp.json` 使用严格解析：格式错误会直接抛错（不会自动过滤或忽略非法字段）。

### 配置示例

```json
{
  "servers": [
    {
      "endpoint": "https://your-mcp-server.example.com/mcp",
      "options": {
        "headers": {
          "Authorization": "Bearer your-token"
        },
        "initialize": {
          "protocolVersion": "2025-03-26",
          "capabilities": {},
          "clientInfo": {
            "name": "bakabot",
            "version": "1.0.0"
          }
        },
        "sendInitializedNotification": true
      }
    }
  ]
}
```

### 字段说明

- `servers`: MCP 服务器列表。
- `servers[].endpoint`: MCP HTTP endpoint。
- `servers[].options.headers`: 请求头，可用于鉴权（例如 `Authorization`）。
- `servers[].options.initialize`: MCP initialize 参数覆盖（可选）。
- `servers[].options.sendInitializedNotification`: 是否发送 `notifications/initialized`（默认 `true`）。

### 行为说明

- 若 `mcp.json` 不存在：跳过 MCP 注册，不影响 Agent 启动。
- 若存在但格式非法：启动时报错，提示配置路径与错误信息。

## 🚀 流式消息发送功能

BakaBot现在支持流式消息发送！当AI生成消息时，会实时分段发送，提供更好的用户体验。

### 特性：
- **实时消息分段**：检测到 `\n\n` 时自动发送前一段
- **智能缓冲**：累积文本并智能分段发送

### 工作原理：
1. AI开始生成响应 → `message_start` 事件
2. 文本增量到达 → `message_update` + `text_delta` 事件
3. StreamBuffer累积并检测 `\n\n`
4. 发送完整段落
5. 消息结束 → `message_end` 事件
6. 发送剩余内容

详细请看[streaming-feature.md](docs/streaming-feature.md)
