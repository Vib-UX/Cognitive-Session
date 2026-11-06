# Session IDE (Cursor / VS Code extension)

In-IDE UI for Session: **Lobby sidebar** + **Chess board tab**. Same relay as the agent plugin.

## What you get

- Activity Bar icon **Session** → Lobby webview (peers, room codes, ping, challenge)
- Command **Session: Open chess board** → board opens in an editor tab
- Click two squares (or type UCI) to move — stays inside Cursor, no browser

## Run

```bash
# terminal 1 — required backend
pnpm --filter @session/relay start

# build + install this extension
pnpm --filter session-ide build
# then install the folder / vsix (see root README)
```

Settings:

- `session.relayUrl` — default `ws://127.0.0.1:47831/ws`
- `session.displayName` — lobby name
