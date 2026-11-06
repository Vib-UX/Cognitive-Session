---
name: session-play
description: Find another live coding session, join a room, ping to prove the connection, and play chess turns inside Claude Code between build steps.
---

# Session play

Use the Session MCP tools and the `/session` pane. Chess is played in this IDE — the pane Board tab and tool replies show the board. Do not open external links to play.

1. `session_me` — your id
2. `session_peers` — lobby (nearby = same Wi-Fi)
3. `session_create_room` / `session_join_room` — pair with a specific person
4. `session_ping` — prove the connection
5. `session_poll` — challenges, match, board
6. Chess: `session_challenge`, `session_respond`, `session_move`, `session_resign`

Keep building as the main task. Handle chess only when a challenge or turn is waiting.
