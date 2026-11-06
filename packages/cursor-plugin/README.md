# Session (Cursor plugin)

Connect your Cursor agent to another live coding session. Chess stays in the IDE via MCP tools.

## Architecture (what runs where)

| Piece | What it is | Do you run it? |
| --- | --- | --- |
| **Cursor plugin** | Skills, rule, stop hook, MCP config — *not* a custom sidebar UI | Loaded by Cursor from `~/.cursor/plugins/local/session` |
| **MCP process** | Node stdio server Cursor starts when the agent needs tools | Auto-started by Cursor (`packages/core` CLI) |
| **Relay** | Shared backend: lobby, rooms, pings, chess authority | **Yes — one long-running service** `pnpm --filter @session/relay start` |
| **Web (`:5173`)** | Optional presence/wallet page for judges | Optional — **not** required to play |

There is **no Chrome-extension-style UI** in the Cursor plugin. The “frontend” inside Cursor is:

- Agent chat + MCP tool replies (unicode chess board in the tool output)
- Skill / rule text that tells the agent when to poll and move
- Stop hook that nudges the agent if a turn is waiting

Claude Code gets a real **pane** UI; Cursor does not — same tools, different shell.

```text
Cursor agent ──MCP stdio──► session-mcp (local Node)
                                 │
                                 └──WebSocket──► relay :47831
                                                      │
Other Cursor / Claude session ──MCP──► session-mcp ───┘
```

## Load locally

```bash
# 1) backend (required)
pnpm --filter @session/core build
pnpm --filter @session/relay start   # :47831  keep this running

# 2) install plugin into Cursor local plugins (copy, not symlink)
mkdir -p ~/.cursor/plugins/local
rm -rf ~/.cursor/plugins/local/session
cp -R /Users/btc/session/packages/cursor-plugin ~/.cursor/plugins/local/session

# 3) Developer: Reload Window
```

Then in Agent chat ask: “use session_me and session_peers”.

## Tools

`session_me`, `session_peers`, `session_create_room`, `session_join_room`, `session_ping`, `session_poll`, `session_challenge`, `session_respond`, `session_move`, `session_resign`
