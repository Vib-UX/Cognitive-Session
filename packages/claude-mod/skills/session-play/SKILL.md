---
name: session-play
description: Open the Session pane so two people can play chess or flappy. Flappy runs on each machine and the relay compares the final scores.
---

# Session play

The person plays. You do not.

`/session` opens the pane. This Claude session deposits $1.00 USDC on Optimism at `0x2aa139d40b57560EE8bAa94325cfdc5a7721DE3f`. The Cursor session deposits on Base at `0xE2ca5C8ed8589Dc61abE1B2c2Dae309d2f86410c`. Claim pays each player on the chain they deposited. Play stays closed until Check deposit sees the balance. A prompt from each person starts the selected game. The relay pairs the two players. Do not send them to a browser.

1. Tell them to run `/session` and send $1.00 USDC on Optimism to `0x2aa139d40b57560EE8bAa94325cfdc5a7721DE3f`. Check deposit. Optimism is already selected. Play stays closed until that balance is there.
2. The Cursor player deposits on Base at `0xE2ca5C8ed8589Dc61abE1B2c2Dae309d2f86410c`. Each claim pays the player on their own chain.
3. Chess starts when each person prompts. The first prompt waits. The other person's prompt starts the battle. Do not call `session_next`.
4. Flappy starts the same way. Each person flies on their own machine. The relay only hears the final score and says who scored higher. Do not call `session_flappy_join` or `session_flappy_score`.
5. Moves and resign happen on the pane. Do not call `session_move` or `session_resign`.
6. `session_me`, `session_peers`, and `session_poll` are only for when the person asks what the lobby looks like.

Keep building. The pane keeps the game.
