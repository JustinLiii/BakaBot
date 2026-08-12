# BakaBot

BakaBot manages independent agent sessions for private chats and groups.

## Language

**Session**:
A private chat or group chat with its own agent state and configuration.
_Avoid_: Global chat, shared session

**Session MCP Configuration**:
The persisted source of truth for all MCP servers configured for one session. It is never shared with or managed from another session.
_Avoid_: Global MCP configuration, bot-wide MCP configuration

**Default MCP Configuration**:
The read-only MCP servers supplied by the BakaBot codebase to every session. If combining it with a Session MCP Configuration is statically invalid, the runtime falls back to the Default MCP Configuration alone.
_Avoid_: Session MCP configuration

**MCP Server Entry**:
A named MCP server inside a Session MCP Configuration. Its name uses ASCII letters, digits, underscores, or hyphens; commands match the name case-insensitively while preserving its original spelling.
_Avoid_: Endpoint

**Configure MCP Server**:
Inspect one MCP Server Entry, or set or unset one of its configuration fields without replacing the other entries in the session.
_Avoid_: Replace MCP configuration

**MCP Server Status**:
The last known connection result and registered tool count for an MCP Server Entry. Status is runtime information, not part of the persisted configuration.
_Avoid_: MCP server configuration

**Active MCP Server**:
An MCP Server Entry whose client connected and whose tools were discovered during the latest reload. A configured entry with an error status is not active.
_Avoid_: Configured MCP server

**MCP Tool Name Conflict**:
A dynamic loading failure caused by two MCP tools, or an MCP tool and an existing AgentTool, resolving to the same registered name. It invalidates only the affected MCP Server Entry.
_Avoid_: Duplicate endpoint

**MCP Server Tool**:
An AgentTool discovered from an active MCP server. Its registered name begins with `mcp_`, followed by the server and tool names.
_Avoid_: MCP Management Tool

**MCP Management Tool**:
An built-in AgentTool that manages MCP servers through the same management interface as slash commands. Management tools use verb-first names such as `list_mcp_servers` and never use the `mcp_` prefix.
_Avoid_: MCP Server Tool

The reserved MCP Management Tool names are `list_mcp_servers`, `get_mcp_server`, `add_mcp_server`, `update_mcp_server`, and `delete_mcp_server`. MCP Server Tools may never use these names, even when a particular Agent does not install the management tools.

**Delete MCP Server**:
Remove one MCP Server Entry together with its registered tools and live client connection. Other entries in the session are unaffected.
_Avoid_: Disable MCP server

**MCP Configuration Reload**:
A hot reload from the persisted Session MCP Configuration. Any statically invalid entry rejects the entire file; after static validation succeeds, entries initialize independently and a dynamic failure affects only that entry.
_Avoid_: MCP configuration rollback
