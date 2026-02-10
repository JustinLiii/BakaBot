# BakaBot Agent Guidelines

This repository contains **BakaBot**, a TypeScript-based bot powered by the `pi-agent-core` and `node-napcat-ts` libraries, running in the **Bun** environment. This bot is designed to handle both private and group messages using an agentic approach.

## 🛠 Commands & Operations

### Build & Dependencies
- **Install dependencies**: `bun install`
- **Build**: No explicit build step required as Bun executes TypeScript directly.

### Running the Application
- **Start the bot**: `bun start` (aliased to `bun index.ts` in `package.json`)
- **Direct execution**: `bun index.ts`
- **Watch mode**: `bun --watch index.ts` (useful during development)

### Testing & Linting
- **Test Framework**: No dedicated test framework is pre-configured, but Bun's built-in test runner is recommended.
- **Run all tests**: No test scripts are currently defined.
- **Linting**: No linter (ESLint/Prettier) is configured. Follow existing formatting manually (2-space indent, semicolons).

---

## 💻 Code Style Guidelines

### 1. General Principles
- **Async/Await**: Mandatory for all asynchronous operations (network, file I/O). Top-level await is fully supported and should be used in entry points like `index.ts`.

### 2. Naming Conventions
- **Variables & Methods**: Use `camelCase`. (e.g., `registerMsgHandler`, `agentDict`, `groupContextLimit`).
- **Files**: Use `snake_case` or `kebab-case`. (e.g., `agent_utils.ts`, `napcat_templates.ts`).
- **Classes**: Use `PascalCase`. (e.g., `BakaBot`, `BakaAgent`).
- **Types/Interfaces**: Use `PascalCase` (e.g., `PrivateMsgHandler`, `AgentOptions`).

### 3. Types & Interfaces
- **Strict Typing**: The `tsconfig.json` has `"strict": true`. Always provide explicit types for:
  - Function parameters and return values.
  - Class properties.
  - Complex object literals.
- **Type Imports**: Use `import type` for importing interfaces or types to ensure they are stripped during compilation.
- **Tool Parameters**: Use `@sinclair/typebox` to define schemas for `AgentTool` parameters. This allows for runtime validation and better type safety.

### 4. Imports & Modules
- **ESM Extensions**: Always include the `.ts` or `.js` extension in local relative imports (e.g., `import { tools } from "./tools.ts"`).
- **Napcat Node**: Check doc and API references for usage from ![什么是 node-napcat-ts](https://node-napcat-ts.huankong.top/guide/what-is-node-napcat-ts)
- **Organization**: 
  1. External library imports (e.g., `@mariozechner/pi-agent-core`).
  2. Local module imports (e.g., `./agent.ts`).
  3. Type-only imports.

### 5. Formatting
- **Indentation**: 2 spaces.
- **Semicolons**: Mandatory.
- **Quotes**: Prefer double quotes `"` for strings. Use template literals `` ` `` for multiline strings or interpolation.

### 6. Error Handling
- **Robustness**: Wrap network calls (API completions) and file system operations in `try/catch` blocks.
- **Expose errors**: Always re-throw errors unless they are expected and handled gracefully.

### 7. Agent-Specific Patterns
- **Tools**: Define tools using the `AgentTool` interface. Each tool should have a clear `description` and a `parameters` schema.
- **Prompts**: Store system and template prompts in `src/prompts/`. Use functions to inject dynamic data into templates (see `napcat_templates.ts`).
- **Subscriptions**: Leverage `agent.subscribe` to hook into lifecycle events like `agent_start`, `message_end`, and `tool_execution_start` for logging or message relay.

---

## 🤖 Integration Rules

### 💾 Data Persistence
- **Bash Tool Workspace**: Stored in `data/sessions/[sessionId]/workspace/`. This directory is mounted as `/workspace` in the Docker container.
- **RAG Storage**: Stored in `data/sessions/[sessionId]/rag/`. Contains `rag_index.json` (vector index) and `rag_metadata.json` (message history).

### Important Notice
- **Differentiate Between Coding Instructions And Project Content**: This is a project about AI agent. Avoid mixing coding instructions with instruction for the AI agent itself. 

### Chat Context Management
- **Context Limits**: The `BakaBot` class enforces a `groupContextLimit` (default 20). When this limit is reached, older messages should be sliced out of the `agent.state.messages` array to prevent token overflow.
- **Session Management**: Each group/user has its own agent session stored in `agentDict`. Sessions are identified by a unique ID generated via `getId(event)`.

### Triggering Logic
- **At-Me**: Always check `atMe(context)` for group messages.
- **Trigger Utility**: Use `triggered(text, agent)` in `src/utils/agent_utils.ts` to determine if the bot should interject in a conversation even without an explicit @ mention.

---

## 📂 Project Structure Overview
- `src/bakabot.ts`: Main bot logic and message routing.
- `src/agent.ts`: Wrapper for the PI Agent, includes model configuration.
- `src/tools.ts`: Definitions for tools (read_file, list_dir, web_fetch, etc.).
- `src/utils/`: Helper functions for path processing, triggering, and message formatting.
- `src/prompts/`: System prompts and message templates.
