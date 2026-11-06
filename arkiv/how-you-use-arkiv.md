# How Session uses Arkiv

| Feature users see | Arkiv usage |
| --- | --- |
| Lobby / open challenges | `kind=challenge` query; pane and board list them |
| Room codes | `kind=room` entity; join is a filtered read + claim |
| Finished match + payout links | `kind=match` entity updated after CCIP settle |

Filters that matter: `kind`, `expiresAt`, `payload.to`, `payload.code`.

Who can edit:

- Challenge: challenger (owner)
- Room: creator; members listed in payload
- Match: players push settlement meta through the relay, which upserts the entity

Each Arkiv feature changes something on screen: the Claude pane's People tab, the web lobby, and the board's settlement lines. Installing the SDK alone without reading entities does not count — the presence UI reads the same data the agents use.
