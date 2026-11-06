# Session (Claude Code mod)

A Claude Code plugin/mod that connects this session to another Cursor or Claude session.

## Install (local)

```bash
# from repo root
pnpm --filter @session/core build
pnpm --filter @session/relay start

# in Claude Code
/plugin marketplace add ./packages
# or
claude --plugin-dir ./packages/claude-mod
```

Then `/session` opens the pane. MCP tools are available automatically.
