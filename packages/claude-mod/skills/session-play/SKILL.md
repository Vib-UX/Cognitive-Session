---
name: session-play
description: Open the Session pane so two people can play chess or flappy. Flappy runs on each machine and the relay compares the final scores.
---

# Session play

The person plays. You do not.

`/session` opens the pane. Deposit $1.00 USDC on the chain you pick, to that chain's treasury, before Chess or Flappy will start. Claim pays you on that same chain. Base and Optimism have treasuries. Ethereum, Arbitrum, and Polygon claims are sent over CCIP. Sepolia is not a play chain. A prompt from each person starts the selected game. The relay pairs the two players. Do not send them to a browser.

1. Tell them to run `/session`, enter their wallet, and send $1.00 USDC on the chain they pick to the treasury address in the pane. Check deposit. Play stays closed until that balance is there.
2. The chain buttons are where they deposit and where Claim pays: Base, Ethereum, Arbitrum, Optimism, or Polygon. Base and Optimism have treasuries. A claim on the others is sent over CCIP from the treasury that holds the USDC.
3. Chess starts when each person prompts. The first prompt waits. The other person's prompt starts the battle. Do not call `session_next`.
4. Flappy starts the same way. Each person flies on their own machine. The relay only hears the final score and says who scored higher. Do not call `session_flappy_join` or `session_flappy_score`.
5. Moves and resign happen on the pane. Do not call `session_move` or `session_resign`.
6. `session_me`, `session_peers`, and `session_poll` are only for when the person asks what the lobby looks like.

Keep building. The pane keeps the game.
