# Session (Claude Code mod)

One pane for two players. `/session` opens it. Pick **Chess** or **Flappy**, then prompt. The relay pairs you with the other live session. The agent does not play.

## Install

```bash
# from the repo root
pnpm --filter @session/core build
claude --plugin-dir ./packages/claude-mod
```

In Claude Code:

1. `/session`
2. Pick Chess or Flappy
3. Prompt. The first prompt waits. The other player's prompt starts the round.
4. Chess is played in the pane. Click a piece and then a square, use the arrows and Enter, or type `e4` / `e2e4`.
5. Flappy flies on your machine. Click the board, then space, ↑, `w`, or Enter flaps. `p` pauses. The course is the same for both players. Nothing is sent until you crash, and the higher score wins.
6. `/session stop` closes the pane and leaves the game on the relay.

`claude plugin validate ./packages/claude-mod` lists the hooks.

The display name and relay URL are read when the MCP process starts. The manifest default is `wss://sessionrelay-production.up.railway.app/ws`. Set `display_name` and `relay_url` in `/config` before that process starts. `pieces` is `unicode` or `letters`. `columns` is the docked pane width, 30–100, default 60.

## What the pane does

- **Chess** is the battle. Your side is at the bottom. The first prompt enters the relay queue. The other player's prompt starts the match. There is no room code and no accept step. A later prompt does not search again, because a new search resigns the live game.
- **Flappy** is local, in the style of the [flappy mod](https://github.com/davila7/claude-code-templates/tree/main/cli-tool/components/mods/games/flappy). Both players get the same seed, fly on their own, and the relay compares the two scores at the end.
