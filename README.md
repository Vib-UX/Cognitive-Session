# Session

Connect two live coding sessions (Cursor or Claude Code), prove the link with a ping, play chess while both agents keep building, then settle a cross-chain wager.

Built in four steps:

1. **Connect** — nearby mDNS + relay lobby + room code + ping
2. **Chess** — authoritative match on the same relay
3. **Wager** — lock on Base Sepolia, pay on Ethereum Sepolia via CCIP 2.0
4. **Arkiv + ENS** — lobby entities and `*.session.eth` names

## Quick start

```bash
pnpm install
pnpm --filter @session/core build
pnpm --filter @session/relay start   # :47831
pnpm --filter @session/web dev       # :5173 presence board
```

In another terminal, run the MCP CLI as two sessions:

```bash
SESSION_HOST=cursor SESSION_DISPLAY_NAME=alice SESSION_DATA_DIR=/tmp/session-a \
  node packages/core/dist/mcp/cli.js

SESSION_HOST=claude SESSION_DISPLAY_NAME=bob SESSION_DATA_DIR=/tmp/session-b \
  node packages/core/dist/mcp/cli.js
```

Or load the plugins:

- Cursor: [packages/cursor-plugin](packages/cursor-plugin)
- Claude Code: `claude --plugin-dir ./packages/claude-mod` then `/session`

## Step 1 demo

1. Start two agents (Cursor plugin and/or Claude `/session` pane).
2. Agent A: `session_create_room` → share the code.
3. Agent B: `session_join_room`.
4. Agent A: `session_ping` to B. The ping shows in the other IDE (Claude pane / next `session_poll`).

Optional judge view: `pnpm --filter @session/web dev` lists presence only. It is not required to play.

## Chess (in-IDE)

Chess is played inside Cursor / Claude Code — no external board link.

`session_challenge` → `session_respond` → `session_move` (UCI, e.g. `e2e4`). Tool replies and the Claude Board tab show a unicode board. Clocks are 5 minutes. The Cursor stop hook and Claude `prompt.submit` nudge the agent when a turn is waiting.

## Contracts

```bash
cd contracts
forge test
forge script script/DeployLocal.s.sol --broadcast   # mock CCIP router
```

- `SessionLock` — Base Sepolia deposits + CCIP send
- `SessionPayout` — Ethereum Sepolia receive + pay winner / split draw
- `SessionNameRegistry` — ENSv2-style permissioned subnames under `session.eth`

Set `VITE_SESSION_LOCK_ADDRESS` / `VITE_SESSION_PAYOUT_ADDRESS` for the web wallet panel.

## Arkiv

When `SESSION_ARKIV_RPC` is set, the relay upserts challenge / room / match entities. Judge notes live in [arkiv/](arkiv/).

## Layout

```
packages/core              shared client + MCP server
packages/cursor-plugin     Cursor Agent plugin (skills / MCP / hooks)
packages/cursor-extension  Cursor/VS Code .vsix UI (sidebar + board tab)
packages/claude-mod        Claude Code mod (pane + hooks)
relay                      presence, rooms, chess, referee path
web                        optional judge presence / wallet page
contracts                  Foundry (lock, payout, names)
arkiv                      Arkiv judge markdown
```

## Cursor UI extension (sidebar + board tab)

This is a real VS Code/Cursor extension (webviews), separate from the agent plugin:

```bash
pnpm --filter @session/relay start          # required
pnpm --filter session-ide build
# installed for local review at ~/.cursor/extensions/session.session-ide-0.1.0
# Reload Window, then open the Session icon in the Activity Bar
```

- **Lobby sidebar** — peers, room code, ping, challenge  
- **Chess board tab** — `Session: Open chess board` (or button in sidebar); click squares or type UCI  
- Agent plugin MCP tools still work in parallel against the same relay

## Sponsor tracks

- ENSv2 — session subnames
- Arkiv — lobby / match entities
- Chainlink CCIP 2.0 — Base Sepolia → Ethereum Sepolia settlement
