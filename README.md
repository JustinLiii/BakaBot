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

## Bash 沙箱

BakaBot 为每个私聊和群聊会话维护一个独立的长驻 Docker 容器。Agent 第一次使用 Bash
工具时创建容器，后续调用通过 `docker exec` 执行；容器停止后会在下一次调用时自动启动。

- 镜像：`juztinlii/bakabot-sandbox`，当前基于 Python 3.12。
- 默认工作目录：`/root`，上一次命令结束时的工作目录会用于下一次调用。
- 持久文件：`/root` 映射到 `data/sessions/<sessionId>/workspace/`。
- 容器状态：安装的软件、容器文件系统修改和后台进程在多次 Bash 调用间保留。
- 资源限制：每个容器最多使用 512 MB 内存和 0.5 CPU。
- 中止：命令超时、Agent abort 和 `/stop` 会终止当前命令的整个容器内进程组。
- Bot 退出：收到 `SIGINT` 或 `SIGTERM` 时会终止当前命令并停止所有会话容器。容器不会
  被删除，下次使用时会重新启动，因此容器文件系统仍会保留。

长期保存的重要数据应写入 `/root`。删除对应 Docker 容器会丢失未写入 `/root` 的容器层修改。

## 🔌 MCP 配置

BakaBot 为每个私聊和群聊会话维护独立的 MCP 配置。配置存储在：

`data/sessions/<sessionId>/mcp.json`

代码库可以在根目录提供只读的默认配置：

`mcp.default.json`

运行时优先合并默认配置和会话配置。默认服务器可以查看但不能通过命令修改或删除；如果合并
结果静态非法，则保留原会话文件并回退到只加载默认配置。默认配置本身静态非法时不加载任何
MCP 服务器。

用户可以通过 `/mcp` 命令管理当前会话的 MCP 服务器。命令执行后会沿用现有 slash command
处理逻辑，消息仍会继续传递给 Agent。

### 命令

```text
/mcp
/mcp add <服务器名称> <JSON 配置>
/mcp list
/mcp conf <服务器名称>
/mcp conf <服务器名称> set <配置项> <JSON 值>
/mcp conf <服务器名称> unset <配置项>
/mcp delete <服务器名称>
```

- `/mcp`、未知子命令和参数不足会返回中文帮助及错误原因。
- 子命令、`set` 和 `unset` 只接受小写。
- 服务器名称只允许英文字母、数字、下划线和连字符。查找时不区分大小写，配置中保留首次
  添加时的写法。
- 同一会话的 MCP 命令串行执行，不同会话可以并行执行。

#### 添加服务器

`add` 接收服务器名称和单个 server 配置对象，不接收完整的 `mcpServers` 外壳：

```text
/mcp add filesystem {"command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","/tmp"]}
/mcp add remote {"url":"https://example.com/mcp","headers":{"Authorization":"Bearer token"}}
```

- 同名服务器已存在时拒绝添加，不自动覆盖。
- 配置在写入前执行静态格式校验；校验失败时不修改 `mcp.json`。
- `mcp.json` 不存在时视为空配置，并在首次添加时创建。

#### 查看服务器状态

```text
/mcp list
```

`list` 返回当前会话的服务器名称、transport、最近一次初始化状态和已注册工具数量，不显示
配置内容，也不会主动重连服务器。

```text
当前会话的 MCP 服务器：
- filesystem [会话][stdio] 已连接，14 个工具
- remote [默认][streamable-http] 初始化失败：401 Unauthorized
```

没有配置时返回：

```text
当前会话没有配置 MCP 服务器。
```

配置文件存在但静态格式非法时返回：

```text
当前会话配置格式错误，已回退到默认 MCP 配置。
当前没有可加载的默认 MCP 服务器。
```

此时除 `/mcp list` 外，`add`、`conf` 和 `delete` 都严格拒绝操作，不尝试从非法文件中读取、
修复或覆盖部分配置。

#### 查看和修改服务器配置

```text
/mcp conf filesystem
```

`conf` 返回该服务器的完整原始 JSON 配置，不包含 `mcpServers` 外壳，也不包含运行状态。

```text
/mcp conf filesystem set command "npx"
/mcp conf filesystem set args ["-y","@modelcontextprotocol/server-filesystem","/tmp"]
/mcp conf remote set headers.Authorization "Bearer token"
/mcp conf filesystem unset env.LOG_LEVEL
```

- 配置项使用点路径访问嵌套对象，例如 `headers.Authorization`。
- `set` 的值必须是合法 JSON。字符串也必须包含 JSON 双引号；裸字符串 `npx` 不合法。
- JSON 值可以包含空格，命令行剩余内容整体作为 JSON 值解析。
- 点路径只支持对象字段，不支持 `args.0` 等数组下标；数组必须整体替换。
- `set` 可以创建缺失的中间对象。
- `unset` 路径不存在时返回错误；删除叶子字段后不自动删除空的父对象。
- 修改后对完整 server 配置执行静态校验，校验失败时不写入文件。
- `conf set/unset` 不自动创建不存在的服务器；新服务器必须通过 `add` 添加。

#### 删除服务器

```text
/mcp delete filesystem
```

删除会移除该服务器的持久化配置、已注册 tools 和 MCP client 连接，不影响当前会话中的其他
服务器。服务器不存在时返回中文错误。删除最后一个服务器后保留空的 `mcp.json`。

### 配置格式

`mcp.json` 是完整 MCP config，顶层必须是 `mcpServers` 对象：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      "env": {
        "LOG_LEVEL": "info"
      }
    },
    "remote": {
      "url": "https://your-mcp-server.example.com/mcp",
      "headers": {
        "Authorization": "Bearer your-token"
      }
    }
  }
}
```

server 配置只接受以下两种严格格式，未知顶层字段会导致静态校验失败。

stdio：

```json
{
  "command": "npx",
  "args": ["-y", "package"],
  "env": {
    "KEY": "value"
  },
  "cwd": "/path"
}
```

- `command`：必填的非空字符串。
- `args`：可选的字符串数组。
- `env`：可选的字符串值对象。
- `cwd`：可选的非空字符串。
- stdio 配置不能包含 `url` 或 `headers`。

Streamable HTTP：

```json
{
  "url": "https://example.com/mcp",
  "headers": {
    "Authorization": "Bearer token"
  }
}
```

- `url`：必填的合法 `http:` 或 `https:` URL。
- `headers`：可选的字符串值对象。
- Streamable HTTP 配置不能包含 `command`、`args`、`env` 或 `cwd`。

### 加载与重载

- Bot 启动和 MCP 命令修改配置后使用相同的完整文件加载流程。
- `mcp.json` 是当前会话 MCP runtime 的唯一事实来源。
- 任意会话 server entry 静态格式非法时，跳过整份会话 `mcp.json`，回退到只加载合法的默认
  配置，并在控制台输出 warning；默认配置本身非法时不初始化任何 MCP server。
- 静态格式合法后，各 server 独立初始化。连接失败、权限错误或工具发现失败只跳过对应
  server；其他 server 继续加载。
- 动态初始化失败的 server 保留在 `mcp.json` 中，但没有活动 client，也不注册 tools。
- 重新加载前移除旧的 MCP tools 和 clients；动态失败时不回退到与文件不一致的旧 runtime。
- MCP tool 注册名为 `mcp_<服务器名称>_<工具名称>`，并规范化为小写字母、数字和下划线。
- 规范化后的名称与其他 MCP tools 或内置 AgentTool 冲突时，对应 server 初始化失败，其他
  server 不受影响。

配置写命令在静态校验并保存后回复中文结果，然后报告目标 server 的动态初始化结果。
如果其他 server 初始化失败，回复失败数量并提示使用 `/mcp list` 查看；每个动态错误同时写入
控制台 warning。动态失败回复包含简短原因，不向 QQ 发送完整堆栈。

成功示例：

```text
已添加 MCP 服务器「filesystem」，并成功加载 14 个工具。
已更新 MCP 服务器「filesystem」的配置项「args」，并成功加载 14 个工具。
已更新 MCP 服务器「filesystem」的配置项「env.LOG_LEVEL」，并成功加载 14 个工具。
已删除 MCP 服务器「filesystem」。
```

配置已保存但目标 server 动态初始化失败时：

```text
已保存 MCP 服务器「remote」的配置，但初始化失败，未注册相关工具。
原因：401 Unauthorized
```

如果目标 server 加载成功，但其他 server 在整份重载中失败，回复会汇总失败数量，并提示使用
`/mcp list` 查看完整状态。成功加载 `0` 个工具仍视为初始化成功。

### 当前安全限制

- 当前不对 `env`、`headers`、token、password 等敏感配置做脱敏；`/mcp conf` 返回原始值。
- 当前私聊用户和群聊所有成员都可以使用全部 `/mcp` 命令，不做角色权限检查。
- MCP 命令执行后仍会透传给 Agent。
- 安全密钥配置渠道和群聊写命令权限控制已记录为后续事项。

### Agent 管理工具

MCP 管理逻辑独立于 slash command。Agent 同样可以通过以下内置工具管理当前会话配置：

```text
list_mcp_servers
get_mcp_server
add_mcp_server
update_mcp_server
delete_mcp_server
```

这些工具使用结构化参数，并与 `/mcp` 命令共享相同的配置校验、只读默认服务器、持久化、
重载、状态和错误语义。来自 MCP server 的动态工具仍使用
`mcp_<服务器名称>_<工具名称>` 前缀；管理工具使用动词优先命名，不占用 `mcp_` 前缀。

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
