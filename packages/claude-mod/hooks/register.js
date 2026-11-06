/**
 * Session Claude Code mod.
 * Draws a pane for nearby / lobby / room / ping, and nudges Claude when a
 * chess turn or challenge is waiting.
 *
 * The MCP server (see .mcp.json) owns the relay connection for tool calls.
 * This mod keeps a lightweight HTTP poll of the presence API for the pane.
 */

const PANE = "session";
const RELAY_HTTP = process.env.SESSION_RELAY_HTTP ?? "http://127.0.0.1:47831";

let tab = "people";
let roomCodeInput = "";
let pingText = "hello from claude";
let lastError = "";
let snapshot = {
  peers: [],
  rooms: [],
  recentPings: [],
  matches: [],
  challenges: [],
};
let meHint = process.env.SESSION_DISPLAY_NAME ?? "claude";
let pollTimer = null;

async function refreshPresence() {
  try {
    const res = await fetch(`${RELAY_HTTP}/presence`);
    if (!res.ok) throw new Error(`presence ${res.status}`);
    snapshot = await res.json();
    lastError = "";
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
  }
}

function activeMatch() {
  return (
    snapshot.matches?.find((m) => m.status !== "finished") ??
    snapshot.matches?.at?.(-1) ??
    null
  );
}

const UNICODE = {
  K: "♔",
  Q: "♕",
  R: "♖",
  B: "♗",
  N: "♘",
  P: "♙",
  k: "♚",
  q: "♛",
  r: "♜",
  b: "♝",
  n: "♞",
  p: "♟",
};

/** In-IDE board from FEN — game stays in Claude Code, no external link. */
function renderBoard(fen) {
  if (!fen) return "(no position)";
  const placement = fen.split(" ")[0] ?? "";
  const ranks = placement.split("/");
  const lines = ["  a b c d e f g h"];
  for (let r = 0; r < ranks.length; r++) {
    const row = [];
    for (const ch of ranks[r] ?? "") {
      if (ch >= "1" && ch <= "8") {
        for (let i = 0; i < Number(ch); i++) row.push("·");
      } else {
        row.push(UNICODE[ch] ?? ch);
      }
    }
    lines.push(`${8 - r} ${row.join(" ")}`);
  }
  const turn = fen.split(" ")[1] === "b" ? "black" : "white";
  lines.push(`turn: ${turn}`);
  return lines.join("\n");
}

function waitingContext(meId) {
  const challenge = (snapshot.challenges ?? []).find((c) => c.to === meId);
  const match = activeMatch();
  const myTurn =
    match &&
    match.status === "active" &&
    meId &&
    ((match.turn === "w" && match.white === meId) ||
      (match.turn === "b" && match.black === meId));
  if (challenge) {
    return `Session: challenge ${challenge.id} from ${challenge.fromName} is waiting. Use session_respond if the user allows it.`;
  }
  if (myTurn) {
    return `Session: it is your turn in chess match ${match.matchId}. Call session_poll and session_move, then continue the build.`;
  }
  return null;
}

export function register(on, options = {}) {
  const displayName = options.display_name ?? meHint;
  meHint = displayName;
  if (options.relay_url) {
    // relay_url is the WS URL; derive HTTP for presence.
    try {
      const u = new URL(options.relay_url.replace(/^ws/, "http"));
      process.env.SESSION_RELAY_HTTP = `${u.protocol}//${u.host}`;
    } catch {
      /* keep default */
    }
  }

  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "session",
      description: "Open the Session pane (nearby, lobby, room, chess)",
    });
    await refreshPresence();
    if (!pollTimer) {
      pollTimer = setInterval(() => {
        refreshPresence().then(() => {
          try {
            $.ui.redraw?.();
          } catch {
            /* redraw may be unavailable between turns */
          }
        });
      }, 2000);
    }
    return next(e);
  });

  on("command.run", { command: "session" }, async ($, e, next) => {
    await $.ui.openPane({ id: PANE, title: "Session" });
    await refreshPresence();
    $.ui.redraw?.();
    return { handled: true };
  });

  on("ui.render", { component: "Pane" }, async ($, e, next) => {
    if (e.requestId !== PANE && e.props?.id !== PANE) return next(e);

    const peers = snapshot.peers ?? [];
    const rooms = snapshot.rooms ?? [];
    const pings = [...(snapshot.recentPings ?? [])].reverse().slice(0, 5);
    const match = activeMatch();

    const peopleTab = {
      type: "Box",
      flexDirection: "column",
      gap: 1,
      children: [
        {
          type: "Text",
          content: lastError
            ? `Relay: ${lastError}`
            : `Lobby · ${peers.length} online · you appear as ${displayName}`,
        },
        {
          type: "Text",
          content: "On this Wi-Fi / lobby",
          bold: true,
        },
        ...peers.slice(0, 12).map((p) => ({
          type: "Text",
          content: `${p.nearby ? "●" : "○"} ${p.ensName ?? p.displayName}  ${p.host}  ${p.roomCode ?? "—"}  ${p.id}`,
        })),
        peers.length === 0
          ? { type: "Text", content: "No peers yet. Start another Session plugin." }
          : null,
        { type: "Text", content: "Rooms", bold: true },
        ...rooms.map((r) => ({
          type: "Text",
          content: `${r.code} · ${r.members.length} members`,
        })),
        { type: "Text", content: "Recent pings", bold: true },
        ...pings.map((p) => ({
          type: "Text",
          content: `${p.fromName}: ${p.text}`,
        })),
        {
          type: "Box",
          flexDirection: "row",
          gap: 1,
          children: [
            {
              type: "Button",
              label: "Refresh",
              onPress: async () => {
                await refreshPresence();
                $.ui.redraw?.();
              },
            },
            {
              type: "Button",
              label: "Board tab",
              onPress: () => {
                tab = "board";
                $.ui.redraw?.();
              },
            },
          ],
        },
        {
          type: "Text",
          content: `Tip: ask Claude to session_create_room / session_join_room / session_ping. Room input: ${roomCodeInput || "(set via agent tools)"}`,
        },
      ].filter(Boolean),
    };

    const boardTab = {
      type: "Box",
      flexDirection: "column",
      gap: 1,
      children: [
        {
          type: "Button",
          label: "People tab",
          onPress: () => {
            tab = "people";
            $.ui.redraw?.();
          },
        },
        match
          ? {
              type: "Text",
              content: [
                `Match ${match.matchId} · ${match.status}`,
                `white ${match.white}`,
                `black ${match.black}`,
                renderBoard(match.fen),
                match.result ? `result ${JSON.stringify(match.result)}` : "",
                match.lockTx ? `lock ${match.lockTx}` : "",
                match.payoutTx ? `payout ${match.payoutTx}` : "",
                "",
                "Play here: ask Claude to session_move (UCI, e.g. e2e4). No external board.",
              ]
                .filter(Boolean)
                .join("\n"),
            }
          : {
              type: "Text",
              content:
                "No active match. Ask Claude to session_challenge a peer in your room. Chess stays in this pane + MCP tools.",
            },
      ],
    };

    return {
      type: "Box",
      flexDirection: "column",
      gap: 1,
      children: [
        {
          type: "Box",
          flexDirection: "row",
          gap: 1,
          children: [
            {
              type: "Button",
              label: tab === "people" ? "[People]" : "People",
              onPress: () => {
                tab = "people";
                $.ui.redraw?.();
              },
            },
            {
              type: "Button",
              label: tab === "board" ? "[Board]" : "Board",
              onPress: () => {
                tab = "board";
                $.ui.redraw?.();
              },
            },
          ],
        },
        tab === "people" ? peopleTab : boardTab,
      ],
    };
  });

  on("prompt.submit", async ($, e, next) => {
    await refreshPresence();
    // Without a guaranteed local me id in the mod, use challenges/matches heuristically.
    const ctx =
      waitingContext(null) ??
      (snapshot.challenges?.length
        ? `Session: ${snapshot.challenges.length} open challenge(s). Call session_poll.`
        : null);
    const match = activeMatch();
    const turnHint =
      match && match.status === "active"
        ? `Session: active chess match ${match.matchId}, turn ${match.turn}. Call session_poll; if it is your turn, session_move then continue building.`
        : ctx;
    if (!turnHint) return next(e);
    return next({
      ...e,
      context: [...(e.context ?? []), turnHint],
    });
  });

  on("turn.complete", async ($, e, next) => {
    const match = activeMatch();
    if (match && match.status === "active") {
      return { text: `Session match ${match.matchId} still active (turn ${match.turn}).` };
    }
    return next(e);
  });
}
