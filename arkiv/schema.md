# Arkiv schema — Session

Namespace: `session`

## Entities

### `challenge`

| Field | Type | Notes |
| --- | --- | --- |
| id | string | `chal_…` |
| kind | `challenge` | |
| owner | wallet / session id | Challenger |
| expiresAt | ms epoch | ~5 minutes |
| payload.from | session id | |
| payload.fromName | string | |
| payload.to | session id | |
| payload.stakeWei | string | `"0"` until wager step |

### `room`

| Field | Type | Notes |
| --- | --- | --- |
| id | string | `room_{CODE}` |
| kind | `room` | |
| owner | session id | Creator |
| expiresAt | ms epoch | Refreshed by heartbeats / activity |
| payload.code | string | 4-char room code |
| payload.members | string[] | Session ids |
| payload.matchId | string \| null | Active chess match |

### `match`

| Field | Type | Notes |
| --- | --- | --- |
| id | string | `match_…` |
| kind | `match` | |
| owner | session id | White player |
| expiresAt | ms epoch | ~24h so the board can show payouts |
| payload.roomCode | string | |
| payload.white / black | session id | |
| payload.status | string | pending_deposit / active / finished |
| payload.result | object \| null | |
| payload.lockTx / ccipMessageId / payoutTx | string \| null | Settlement trail |
| payload.fen | string | Snapshot only — live moves stay on the relay |

## Ownership and expiry

- Challenges are owned by the challenger and die quickly if unanswered.
- Rooms are owned by the creator; members claim by joining.
- Match records outlive the game so anyone can query the CCIP settlement trail.
- Live chess plies are **not** Arkiv entities. The relay is the move pipe.
