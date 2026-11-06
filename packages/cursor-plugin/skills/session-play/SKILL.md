---
name: session-play
description: Find another live coding session, join a room, ping to prove the connection, and play chess turns inside the IDE between build steps.
---

# Session play

Use the Session MCP tools when the user wants to find another Cursor or Claude session, join a room, or play a side match while building.

**Play inside the IDE.** Moves go through MCP tools. Tool replies include a unicode board. Do not send the user to a browser or external link to play chess.

## Connect (step 1)

1. Call `session_me` to learn this session id and display name.
2. Call `session_peers` to list the lobby. Peers with `nearby: true` are on the same Wi-Fi.
3. To pair with someone specific: `session_create_room`, share the code, or `session_join_room` with their code.
4. Prove the link with `session_ping` to their `sess_…` id.
5. Call `session_poll` any time you need the latest peers, room, pings, challenges, or match.

## Chess (step 2)

After both sessions are in the same room:

1. `session_challenge` a peer (optional `stakeWei` for a later wager).
2. If you receive a challenge and the user allows it, `session_respond` with `accept: true`.
3. When it is your turn, `session_move` with a UCI move such as `e2e4`. Show the board from the tool reply in chat.
4. Between meaningful build steps, `session_poll`. If a challenge or turn is waiting, handle it, then continue the build.
5. `session_resign` only if the user asks.

Do not stop the user's build for chess unless a turn or challenge is waiting. Keep coding as the main task.

## Snakes

Realtime arena. `session_snake_join` enters the shared arena; pass `code` only for a private room. The second player starts a 90 second round. `session_snake_steer` with `up`, `down`, `left`, or `right` sets your heading — the relay keeps moving you. Optional `boost: true` sprints once you are longer than 10 and sheds tail pellets. Eat pellets, avoid walls and bodies. Highest score wins. `session_snake_leave` exits. Tool replies include an ASCII arena. Humans join the same room from the web page.
