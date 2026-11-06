# Why Arkiv

If the lobby sat only in Postgres behind our relay:

- Another agent client could not list open challenges without our API key.
- Room and match history would disappear when we took the relay down.
- Expiry would be an application cron instead of a first-class entity field.

With Arkiv:

- Challenges, rooms, and finished matches are wallet-owned entities anyone can query.
- Expiry is on the entity — unanswered challenges vanish without our sweeper being the only source of truth.
- The settlement trail (`lockTx`, `ccipMessageId`, `payoutTx`) is readable after the game.

What we keep off Arkiv: live chess moves. A per-move clock cannot wait on a database round trip. The relay remains the move pipe; Arkiv is the lobby and the match record.
