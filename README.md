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
- Claude Code: `claude --plugin-dir ./packages/claude-mod`, then `/session`

## Step 1 demo

1. Start two agents (Cursor plugin and/or Claude `/session` pane).
2. Agent A: `session_create_room` → share the code.
3. Agent B: `session_join_room`.
4. Agent A: `session_ping` to B. The ping shows in the other IDE (Claude pane / next `session_poll`).

Optional judge view: `pnpm --filter @session/web dev` lists presence only. It is not required to play.

## Chess (in-IDE)

Chess is played inside Cursor / Claude Code. The relay connects the two players. There is no external board.

Claude Code: `/session`, pick Chess or Flappy, then each person prompts. The first prompt waits. The other player's prompt starts the round. Flappy runs on each machine and the relay compares the final scores. The person plays. The agent does not move. `/session stop` closes the pane and leaves the game on the relay.

Cursor still pairs from a prompt through the same relay queue, and can also `session_challenge` → `session_respond` → `session_move` (UCI, e.g. `e2e4`). Clocks are 5 minutes. The Cursor stop hook nudges the agent when a turn is waiting.

Check the Claude hooks with `claude plugin validate ./packages/claude-mod`.

## Contracts

```bash
cd contracts
forge test
forge script script/DeployLocal.s.sol --broadcast   # mock CCIP router
```

- `SessionLock` — Base Sepolia deposits + CCIP send
- `SessionPayout` — Ethereum Sepolia receive + pay winner / split draw
- `SessionNameRegistry` — ENSv2-style permissioned subnames under `session.eth`
- `SessionTreasury` — USDC on Base and Optimism. Same-chain transfer on the chain where it is deployed, CCIP 2.0 to the other mainnets

Set `VITE_SESSION_LOCK_ADDRESS` / `VITE_SESSION_PAYOUT_ADDRESS` for the web wallet panel.

## Relay

The public relay is [sessionrelay-production.up.railway.app](https://sessionrelay-production.up.railway.app). `GET /health` reports the process, and agents connect at `wss://sessionrelay-production.up.railway.app/ws`.

A claim asks that relay to pay USDC from the Base treasury. The relay holds the owner key and is the only signer. Set these on the Railway service, then redeploy:

```
TREASURY_PRIVATE_KEY=
SESSION_TREASURY_ADDRESS=0xE2ca5C8ed8589Dc61abE1B2c2Dae309d2f86410c
SESSION_TREASURY_OPTIMISM=0x2aa139d40b57560EE8bAa94325cfdc5a7721DE3f
BASE_RPC_URL=https://mainnet.base.org
OPTIMISM_RPC_URL=https://mainnet.optimism.io
TREASURY_MAX_UNITS=3000000
```

`TREASURY_MAX_UNITS` is 3 USDC per wallet per UTC day. Local development still uses `pnpm --filter @session/relay start`.

## USDC treasuries

[SessionTreasury on Base](https://basescan.org/address/0xE2ca5C8ed8589Dc61abE1B2c2Dae309d2f86410c) pays USDC directly on Base. [SessionTreasury on Optimism](https://optimistic.etherscan.io/address/0x2aa139d40b57560EE8bAa94325cfdc5a7721DE3f) pays USDC directly on Optimism. A player deposits USDC on the chain they pick. CCIP delivers a claim when that chain's treasury is not the one holding the tokens.

- Base deploy: https://basescan.org/tx/0x593afe3bcb37b3367a5045c840f3f32b015733831b10a8450713ec44ce1195e0
- Optimism deploy: https://optimistic.etherscan.io/tx/0xc901823f99f1c32f3b72af36792e69c9afc1d29c2a964f6644c9a800f5946a57
- Fund 0.059594 USDC on Base: https://basescan.org/tx/0x9694d417ea982d7cef82bddf2e78d3940eddf9ec415c3df0ccc9998487b045ad
- Send 0.05 USDC to the owner wallet on Optimism: https://basescan.org/tx/0x6454caca63b294101920e33a01b628910e54e0dc171719f30af43e54c12a4696
- CCIP message: https://ccip.chain.link/msg/0xffa95e81e2a89a55f2f9352e7930f07c97157646558135c5000d420e81cf915d

The Cursor Credits card lists each successful claim with its Base transaction.

### CCIP Local Simulator

`forge test` covers the treasury with `MockRouter`. `SessionTreasurySimulator` also sends a reward through Chainlink's official `CCIPLocalSimulator` from [chainlink-local v0.3.1](https://github.com/smartcontractkit/chainlink-local/tree/v0.3.1). The simulator has one chain selector and pays CCIP-BnM. It checks the packed CCIP 2.0 extra-args encoding the relay submits on mainnet.

Initialize `chainlink-local` on its own, then fetch only the pinned libraries that simulator imports. A recursive checkout of this submodule pulls several large Chainlink repositories.

```bash
cd contracts
git submodule update --init lib/chainlink-local
cd lib/chainlink-local/lib
git clone --depth 1 --branch v4.8.3 https://github.com/OpenZeppelin/openzeppelin-contracts.git openzeppelin-contracts-4.8.3
git clone --depth 1 --branch v5.3.0 https://github.com/OpenZeppelin/openzeppelin-contracts.git openzeppelin-contracts-5.3.0
git init chainlink-ccip
git -C chainlink-ccip remote add origin https://github.com/smartcontractkit/chainlink-ccip
git -C chainlink-ccip fetch --depth 1 origin c2c125c27f056db2e98d21501922b6eff5750f36
git -C chainlink-ccip checkout --force FETCH_HEAD
git init chainlink-evm
git -C chainlink-evm remote add origin https://github.com/smartcontractkit/chainlink-evm
git -C chainlink-evm sparse-checkout init --cone
git -C chainlink-evm sparse-checkout set contracts/src/v0.8/shared
git -C chainlink-evm fetch --filter=blob:none --depth 1 origin 86aa5a1d34b20eda8d18fe6eb0e4882948e545ba
git -C chainlink-evm checkout --force FETCH_HEAD
cd ../../..
forge test --match-contract SessionTreasury
```

## Arkiv

When `SESSION_ARKIV_RPC` is set, the relay upserts challenge / room / match entities. Judge notes live in [arkiv/](arkiv/).

## 0G Storage

When `SESSION_0G_PRIVATE_KEY` is set, the relay uploads each finished chess match as JSON (players, result, CCIP message id) through the 0G Storage indexer. The returned root hash is stored on the match as `ogRoot`. `SESSION_0G_RPC` and `SESSION_0G_INDEXER` default to the Galileo testnet RPC and the turbo indexer.

## Layout

```
packages/core              shared client + MCP server
packages/cursor-plugin     Cursor Agent plugin (skills / MCP / hooks)
packages/cursor-extension  Cursor/VS Code .vsix UI (sidebar + board tab)
packages/claude-mod        Claude Code mod (pane + hooks)
relay                      presence, rooms, chess, USDC claim signer
web                        optional judge presence / wallet page
contracts                  Foundry (lock, payout, names, Base USDC treasury)
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

- **Lobby sidebar** — peers, room code, ping, challenge, and the Credits ledger of USDC claims
- **Chess board tab** — `Session: Open chess board` (or button in sidebar); click squares or type UCI
- Agent plugin MCP tools still work in parallel against the same relay. The installed extension uses the Railway relay above.

## Sponsor tracks

- ENSv2 — session subnames
- Arkiv — lobby / match entities
- 0G Storage — finished match records
- Chainlink CCIP 2.0 — Base mainnet USDC treasury, plus the Base Sepolia → Ethereum Sepolia wager. Local coverage includes Chainlink's CCIP Local Simulator.
