# Arkiv friction

What we want improved while building Session at ETHGlobal Mumbai:

1. **Official TypeScript SDK install story for hackathon laptops.** We kept `@arkiv-network/sdk` behind `SESSION_ARKIV_RPC` and shipped an in-memory / JSON-RPC fallback so the lobby demo still works offline. A one-command `npx` scaffold with faucet + example upsert would cut setup time.
2. **Documented entity TTL refresh semantics.** Session heartbeats need a cheap "bump expiry" without rewriting the whole payload. Clarify whether refresh is a first-class RPC.
3. **Query examples for agent lobbies.** Filtering open challenges by `kind`, `expiresAt > now`, and `payload.to = me` is the main read path. Sample queries in the docs would help judges re-run our README query.

When something broke: without a live Arkiv RPC in CI, writes silently no-op unless `SESSION_ARKIV_RPC` is set. That is intentional for step-1 demos; for judging we point the relay at the current testnet (chain id 7794095) and re-run the import.
