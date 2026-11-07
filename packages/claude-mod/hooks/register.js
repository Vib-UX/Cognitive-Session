/**
 * Session Claude Code mod.
 * /session opens one pane. Chess and Flappy are picked inside it.
 * A prompt starts the selected game. Flappy flies on this machine; the relay
 * only compares the final scores. The person plays.
 * The agent is not a player. This file has no Node APIs: the MCP process
 * in .mcp.json owns the single relay socket.
 */

const PANE = "session";

let game = "chess";
let paneOpen = false;
let letters = false;
let columns = 60;
let zoom = 3;
let selected = null;
let lastError = "";
let seenFen = "";
let lastMove = null;
let lastMatchId = "";
let tickN = 0;
let pendingFlappy = null;
let chain = Promise.resolve();
let mcpServer = "";
let snap = emptySnap();

function emptySnap() {
  return {
    me: null,
    peers: [],
    match: null,
    flappy: null,
    bank: null,
    seeking: false,
    waiting: 0,
    drawing: false,
    legalMoves: [],
  };
}

function enqueue(fn) {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => {},
    () => {},
  );
  return run;
}

function parseToolText(text) {
  const body = String(text || "").trim();
  if (!body) return {};
  const marker = "\n\n---\n";
  const idx = body.lastIndexOf(marker);
  const jsonText = idx >= 0 ? body.slice(idx + marker.length) : body;
  return JSON.parse(jsonText);
}

/** The plugin's own server runs as `plugin:session:session`; connect() names it. */
async function serverName($) {
  if (mcpServer) return mcpServer;
  const res = await $.mcp.connect("session");
  if (!res.isConnected) throw new Error(`Session MCP not connected: ${res.message || res.reason || "unknown"}`);
  mcpServer = res.server;
  return mcpServer;
}

async function callTool($, name, args) {
  const result = await $.mcp.call(await serverName($), name, args || {});
  const text = (result.content || [])
    .map((block) => (block && typeof block.text === "string" ? block.text : ""))
    .join("\n");
  if (result.isError) throw new Error(text.trim() || `${name} failed`);
  return parseToolText(text);
}

function liveChess() {
  return Boolean(snap.match && snap.match.status !== "finished");
}

function myColor() {
  const me = snap.me && snap.me.id;
  if (!snap.match || !me) return "w";
  return snap.match.black === me ? "b" : "w";
}

function myTurn() {
  const match = snap.match;
  if (!match || match.status !== "active") return false;
  return match.turn === myColor();
}

function nameOf(id) {
  const peer = (snap.peers || []).find((item) => item.id === id);
  return (peer && peer.displayName) || id || "opponent";
}

function opponentName() {
  const match = snap.match;
  const me = snap.me && snap.me.id;
  if (!match || !me) return "opponent";
  return nameOf(match.white === me ? match.black : match.white);
}

function statusLine() {
  if (game === "flappy") {
    const flap = snap.flappy;
    if (!flap || flap.status === "waiting") return "session: flappy · waiting for a player";
    if (flap.status === "playing" && flap.you == null) return "session: flappy · you fly, then we compare";
    if (flap.status === "playing") return `session: flappy · you ${flap.you} · waiting for ${flap.themName || "them"}`;
    if (flap.winner === "draw") return `session: flappy · draw ${flap.you}`;
    if (flap.winner === "you") return `session: flappy · you win ${flap.you} to ${flap.them}`;
    return `session: flappy · ${flap.themName || "they"} win ${flap.them} to ${flap.you}`;
  }
  if (snap.drawing) return "session: chess · drawing colors";
  if (snap.seeking && !liveChess()) return "session: chess · waiting for a player";
  if (liveChess() && myTurn()) return `session: chess · your move vs ${opponentName()}`;
  if (liveChess()) return `session: chess · waiting on ${opponentName()}`;
  return "session: chess · prompt to find a player";
}

function paintStatus($) {
  if (!paneOpen) return;
  $.ui.status(statusLine());
}

/** The move between two positions, from the squares that changed. */
function moveBetween(prevFen, nextFen) {
  if (!prevFen || !nextFen) return null;
  const before = piecesFromFen(prevFen);
  const after = piecesFromFen(nextFen);
  const emptied = [];
  const filled = [];
  for (const file of "abcdefgh") {
    for (let rank = 1; rank <= 8; rank++) {
      const sq = `${file}${rank}`;
      if (before[sq] === after[sq]) continue;
      if (before[sq] && !after[sq]) emptied.push(sq);
      else if (after[sq]) filled.push(sq);
    }
  }
  if (!emptied.length || !filled.length) return null;
  // Castling moves two pieces: the king's squares name the move.
  const from = emptied.find((sq) => "Kk".includes(before[sq])) || emptied[0];
  const to = filled.find((sq) => after[sq] === before[from]) || filled[0];
  return from + to;
}

function applySnap(data) {
  if (!data || typeof data !== "object") return;
  if (data.match && data.match.fen && data.match.fen !== seenFen) {
    lastMove = data.match.matchId === lastMatchId ? moveBetween(seenFen, data.match.fen) : null;
    lastMatchId = data.match.matchId;
    selected = null;
    seenFen = data.match.fen;
  }
  snap = {
    ...snap,
    ...data,
    peers: Array.isArray(data.peers) ? data.peers : snap.peers,
    legalMoves: Array.isArray(data.legalMoves) ? data.legalMoves : snap.legalMoves,
    flappy: data.flappy === undefined ? snap.flappy : data.flappy,
    bank: data.bank === undefined ? snap.bank : data.bank,
  };
}

async function refresh($) {
  applySnap(await callTool($, "session_poll", {}));
  lastError = "";
  paintStatus($);
  $.ui.invalidate("ui.render");
}

async function startFromPrompt($) {
  if (!funded()) {
    lastError = "Deposit $1.00 USDC on your chain's treasury before you play.";
    paintStatus($);
    $.ui.invalidate("ui.render");
    return;
  }
  if (game === "chess") {
    if (!liveChess()) applySnap(await callTool($, "session_next", {}));
  } else if (!snap.flappy || snap.flappy.status !== "playing") {
    applySnap(await callTool($, "session_flappy_join", {}));
  }
  await refresh($);
}

function piecesFromFen(fen) {
  const map = {};
  if (!fen) return map;
  const ranks = String(fen).split(" ")[0].split("/");
  for (let r = 0; r < ranks.length; r++) {
    let file = 0;
    for (const ch of ranks[r]) {
      if (ch >= "1" && ch <= "8") {
        file += Number(ch);
      } else {
        map[`abcdefgh`[file] + (8 - r)] = ch;
        file += 1;
      }
    }
  }
  return map;
}

function isMine(piece, color) {
  if (!piece) return false;
  const white = piece === piece.toUpperCase();
  return color === "w" ? white : !white;
}

function clock(ms) {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function noteError($, err) {
  lastError = err instanceof Error ? err.message : String(err);
  try {
    $.ui.invalidate("ui.render");
  } catch {
    /* the pane may already be gone */
  }
}

async function playMove($, text) {
  const match = snap.match;
  if (!match) return;
  await callTool($, "session_move", { matchId: match.matchId, uci: String(text || "") });
  await refresh($);
}

function onSquare($, sq) {
  const match = snap.match;
  if (!match || match.status !== "active") return;
  const pieces = piecesFromFen(match.fen);
  const piece = pieces[sq];
  const legal = snap.legalMoves || [];
  if (selected) {
    const options = legal.filter((move) => move.slice(0, 2) === selected && move.slice(2, 4) === sq);
    if (options.length && myTurn()) {
      const queen = options.find((move) => move.length === 4 || move.endsWith("q"));
      const uci = queen || options[0];
      selected = null;
      enqueue(() => playMove($, uci)).catch((err) => noteError($, err));
      return;
    }
  }
  if (isMine(piece, myColor()) && myTurn()) {
    selected = selected === sq ? null : sq;
  } else {
    selected = null;
  }
  $.ui.invalidate("ui.render");
}

async function flushFlappy($) {
  if (!pendingFlappy) return;
  const { contestId, score } = pendingFlappy;
  applySnap(await callTool($, "session_flappy_score", { contestId, score }));
  if (snap.flappy && snap.flappy.you != null) pendingFlappy = null;
  await refresh($);
}

async function findPlayer($) {
  if (!funded()) {
    lastError = "Deposit $1.00 USDC on your chain's treasury before you play.";
    paintStatus($);
    $.ui.invalidate("ui.render");
    return;
  }
  if (liveChess() || snap.seeking) return;
  applySnap(await callTool($, "session_next", {}));
  await refresh($);
}

function identityLine(Text) {
  const me = snap.me;
  const peers = (snap.peers || []).length;
  if (!me) return Text({ key: "who", color: "warning", children: ["◌ connecting to the relay…"] });
  return Text({
    key: "who",
    dimColor: true,
    children: [`● ${me.displayName} · ${peers} ${peers === 1 ? "peer" : "peers"} online`],
  });
}

const PAYOUT_CHAINS = [
  { id: 10, name: "Optimism" },
  { id: 8453, name: "Base" },
  { id: 1, name: "Ethereum" },
  { id: 42161, name: "Arbitrum" },
  { id: 137, name: "Polygon" },
];
const TREASURY = "0x2aa139d40b57560EE8bAa94325cfdc5a7721DE3f";
let payoutChain = 10;
let walletDraft = "";

function funded() {
  return Boolean(snap.bank && snap.bank.canPlay);
}

async function checkDeposit($) {
  const wallet = (walletDraft || (snap.me && snap.me.walletAddress) || "").trim();
  applySnap(await callTool($, "session_set_player", { wallet, chainId: payoutChain }));
  applySnap(await callTool($, "session_sync_deposit", {}));
  lastError = funded() ? "" : "No USDC deposit yet. Send $1.00 on the chain you picked, then check again.";
}

function depositBlock($, ui) {
  const { Box, Text, Button, Input } = ui;
  const bank = snap.bank;
  const known = { 8453: "0xE2ca5C8ed8589Dc61abE1B2c2Dae309d2f86410c", 10: TREASURY, 1: "" };
  const address = known[payoutChain] || (bank && bank.address) || "This chain has no treasury yet";
  const chainName = (PAYOUT_CHAINS.find((item) => item.id === payoutChain) || PAYOUT_CHAINS[0]).name;
  const balance = (bank && bank.balanceUsd) || "$0.00";
  const rows = [
    Text({
      key: "deposit-hint",
      children: ["Send $1.00 USDC on Optimism to this treasury. Claim pays you on Optimism."],
    }),
    Text({ key: "deposit-address", color: "claude", children: [address] }),
    Text({
      key: "deposit-chain",
      color: "subtle",
      children: [`This Claude session deposits on ${chainName}. Cursor deposits on Base.`],
    }),
    Text({ key: "deposit-balance", children: [`Balance ${balance}`] }),
  ];
  if (bank && bank.transfer && bank.transfer.line) {
    rows.push(Text({ key: "deposit-transfer", children: [bank.transfer.line] }));
  }
  if (bank && bank.note) rows.push(Text({ key: "deposit-note", color: "subtle", children: [bank.note] }));
  rows.push(
    Input({
      key: "wallet",
      label: "wallet",
      placeholder: "0x…",
      onSubmit: (value) => {
        walletDraft = String(value || "");
        enqueue(() => checkDeposit($)).catch((err) => noteError($, err));
      },
    }),
  );
  rows.push(
    Box({
      key: "chains",
      flexDirection: "row",
      gap: 1,
      children: PAYOUT_CHAINS.map((item) =>
        Button({
          key: `chain-${item.id}`,
          label: item.name,
          dimColor: item.id !== payoutChain,
          onPress: () => {
            payoutChain = item.id;
            $.ui.invalidate("ui.render");
          },
        }),
      ),
    }),
  );
  rows.push(
    Box({
      key: "deposit-actions",
      flexDirection: "row",
      gap: 1,
      children: [
        Button({
          key: "check-deposit",
          label: "Check deposit",
          onPress: act($, () => checkDeposit($)),
        }),
        Button({
          key: "claim-balance",
          label: (bank && bank.claimLabel) || "Claim",
          dimColor: !(bank && bank.canClaim),
          onPress: act($, async () => {
            if (!bank || !bank.canClaim) return;
            applySnap(await callTool($, "session_claim", {}));
            await refresh($);
          }),
        }),
      ],
    }),
  );
  return rows;
}

function act($, fn) {
  return () => {
    enqueue(() => fn()).catch((err) => noteError($, err));
  };
}

// Board widths for board.js sizes: eight squares of 3, 5, 7 or 9 cells plus rank labels.
const BOARD_WIDTH = [26, 42, 58, 74];

/** The size board.js draws: the zoom picked, capped by what the pane holds. */
function boardSize() {
  let fit = 0;
  while (fit + 1 < BOARD_WIDTH.length && BOARD_WIDTH[fit + 1] <= columns) fit += 1;
  return Math.min(zoom, fit);
}

async function zoomBy($, step) {
  zoom = Math.min(BOARD_WIDTH.length - 1, Math.max(0, boardSize() + step));
  if (BOARD_WIDTH[zoom] > columns) {
    columns = BOARD_WIDTH[zoom];
    await openPane($);
  }
  $.ui.invalidate("ui.render");
}

function renderChess($, ui) {
  const { Box, Text, Button, Input, Client } = ui;
  const match = snap.match;
  const active = Boolean(match && match.status === "active");
  const rows = [identityLine(Text)];

  if (!match || match.status !== "active") {
    const wait = snap.drawing
      ? "Drawing colors…"
      : snap.seeking
        ? "Looking for an opponent… they join when they prompt."
        : "Find a player, or just send a prompt. Their prompt starts the game.";
    rows.push(Text({ key: "wait", color: snap.seeking || snap.drawing ? "warning" : "text", children: [wait] }));
    if (match && match.result) {
      const won = match.result.kind === "win" && match.result.winner === snap.me?.id;
      const label = match.result.kind === "draw" ? "Draw" : won ? "You won" : "You lost";
      rows.push(
        Text({
          key: "result",
          weight: "bold",
          color: match.result.kind === "draw" ? "warning" : won ? "success" : "error",
          children: [`${label} · ${match.result.reason}`],
        }),
      );
    }
    if (!snap.seeking && !snap.drawing) {
      rows.push(
        Box({
          key: "find",
          children: [
            Button({ key: "find-player", label: "Find a player", hotkey: "f", onPress: act($, () => findPlayer($)) }),
          ],
        }),
      );
    }
    if (!match) return rows;
  }

  const color = myColor();
  const legal = snap.legalMoves || [];
  const dests = selected ? legal.filter((move) => move.slice(0, 2) === selected).map((move) => move.slice(2, 4)) : [];
  const turn = myTurn();
  const clocks = match.clocksMs || null;
  const mine = clocks ? clock(clocks[color]) : "";
  const theirs = clocks ? clock(clocks[color === "w" ? "b" : "w"]) : "";

  rows.push(
    Box({
      key: "players",
      flexDirection: "row",
      justifyContent: "space-between",
      children: [
        Text({ key: "opp", children: [`${color === "w" ? "♚" : "♔"} ${opponentName()}`] }),
        Text({ key: "opp-clock", color: !turn && active ? "warning" : "subtle", weight: "bold", children: [theirs] }),
      ],
    }),
  );
  rows.push(
    Client({
      key: "board",
      module: "./board.js",
      props: {
        game: "chess",
        fen: match.fen,
        color,
        selected,
        dests,
        lastMove,
        letters,
        active,
        zoom,
      },
    }),
  );
  rows.push(
    Box({
      key: "zoom",
      flexDirection: "row",
      gap: 2,
      children: [
        Button({ key: "zoom-out", label: "Zoom −", hotkey: "o", dimColor: true, onPress: act($, () => zoomBy($, -1)) }),
        Button({ key: "zoom-in", label: "Zoom +", hotkey: "i", dimColor: true, onPress: act($, () => zoomBy($, 1)) }),
      ],
    }),
  );
  rows.push(
    Box({
      key: "me",
      flexDirection: "row",
      justifyContent: "space-between",
      children: [
        Text({
          key: "turn",
          weight: "bold",
          color: !active ? "subtle" : turn ? "success" : "subtle",
          children: [
            !active ? "Game over" : turn ? `▶ Your move (${color === "w" ? "White" : "Black"})` : "Their move…",
          ],
        }),
        Text({ key: "my-clock", color: turn ? "success" : "subtle", weight: "bold", children: [mine] }),
      ],
    }),
  );
  if (active) {
    rows.push(
      Input({
        key: "move",
        label: "move",
        placeholder: "or type e4, Nf3, O-O",
        onSubmit: (value) => {
          enqueue(() => playMove($, value)).catch((err) => noteError($, err));
        },
      }),
    );
    rows.push(
      Box({
        key: "actions",
        flexDirection: "row",
        children: [
          Button({
            key: "resign",
            label: "Resign",
            dimColor: true,
            onPress: act($, async () => {
              await callTool($, "session_resign", { matchId: match.matchId });
              await refresh($);
            }),
          }),
        ],
      }),
    );
  }
  return rows;
}

function renderFlappy($, ui) {
  const { Text, Button, Client } = ui;
  const flap = snap.flappy;
  const playing = flap && flap.status === "playing";
  const rows = [identityLine(Text)];
  const line =
    !flap || flap.status === "waiting"
      ? "Waiting for the other player to prompt."
      : flap.status === "done" && flap.winner === "you"
        ? `You win ${flap.you} to ${flap.them}.`
        : flap.status === "done" && flap.winner === "them"
          ? `${flap.themName || "They"} win ${flap.them} to ${flap.you}.`
          : flap.status === "done"
            ? `Draw. ${flap.you} each.`
            : flap.you == null
              ? `Flying against ${flap.themName || "the other player"}. The relay compares the final scores.`
              : `You scored ${flap.you}. Waiting for ${flap.themName || "them"}.`;
  rows.push(Text({ key: "flappy-status", color: flap && flap.status === "done" ? "success" : "subtle", children: [line] }));
  rows.push(
    Client({
      key: "flappy-board",
      module: "./board.js",
      props: {
        game: "flappy",
        contestId: playing ? flap.id : "",
        seed: playing ? flap.seed : 0,
        status: flap ? flap.status : "waiting",
        you: flap ? flap.you : null,
        them: flap ? flap.them : null,
        themName: flap ? flap.themName || "" : "",
        winner: flap ? flap.winner : null,
      },
    }),
  );
  if (!playing) {
    rows.push(
      Button({
        key: "find-flappy",
        label: "Find a player",
        hotkey: "f",
        onPress: act($, () => startFromPrompt($)),
      }),
    );
  }
  return rows;
}

function tab($, ui, id, label, hotkey) {
  const { Button, Text } = ui;
  const on = game === id;
  return Button({
    key: `pick-${id}`,
    hotkey,
    plain: true,
    onPress: () => {
      game = id;
      paintStatus($);
      $.ui.invalidate("ui.render");
    },
    children: [
      Text({
        key: "t",
        weight: on ? "bold" : "regular",
        color: on ? "claude" : "subtle",
        underline: on,
        children: [label],
      }),
    ],
  });
}

function renderPane($, ui) {
  const { Box, Text, Button } = ui;
  const error = lastError ? Text({ key: "error", color: "error", children: [`! ${lastError}`] }) : null;
  const ready = funded();
  const chainName = (PAYOUT_CHAINS.find((item) => item.id === payoutChain) || PAYOUT_CHAINS[0]).name;
  const body = ready ? (game === "flappy" ? renderFlappy($, ui) : renderChess($, ui)) : depositBlock($, ui);
  const balance =
    ready && snap.bank
      ? Box({
          key: "funded",
          flexDirection: "row",
          gap: 2,
          children: [
            Text({ key: "funded-balance", color: "subtle", children: [`${snap.bank.balanceUsd} · claim pays ${chainName}`] }),
            Button({
              key: "claim-funded",
              label: snap.bank.claimLabel || "Claim",
              dimColor: !snap.bank.canClaim,
              onPress: act($, async () => {
                applySnap(await callTool($, "session_claim", {}));
                await refresh($);
              }),
            }),
          ],
        })
      : null;
  return Box({
    flexDirection: "column",
    gap: 1,
    children: [
      Box({
        key: "tabs",
        flexDirection: "row",
        gap: 2,
        children: ready
          ? [tab($, ui, "chess", "♞ Chess", "c"), tab($, ui, "flappy", "▸ Flappy", "f")]
          : [Text({ key: "locked", color: "warning", children: ["Deposit $1.00 USDC on your chain to play"] })],
      }),
      balance,
      error,
      ...body,
    ].filter(Boolean),
  });
}

async function openPane($) {
  paneOpen = true;
  const pane = { id: PANE, title: "Session", focus: true, closeOnEscape: true };
  if (columns) pane.columns = columns;
  await $.ui.open(pane);
  paintStatus($);
}

export function register(on, options = {}) {
  letters = options.pieces === "letters";
  const width = Number(options.columns);
  if (width >= 30 && width <= 100) columns = Math.round(width);

  on("session.start", async ($, e, next) => {
    try {
      if (options.display_name) await $.env.set("SESSION_DISPLAY_NAME", String(options.display_name));
      if (options.relay_url) await $.env.set("SESSION_RELAY_URL", String(options.relay_url));
    } catch {
      /* the manifest env is used when the MCP process is already up */
    }
    $.clock.every(400, () => {
      if (!paneOpen) return;
      tickN += 1;
      const flap = snap.flappy;
      const flappyHot =
        game === "flappy" &&
        (pendingFlappy ||
          flap?.status === "waiting" ||
          (flap?.status === "playing" && flap.you != null && flap.them == null));
      const hot = flappyHot || snap.seeking || snap.drawing || liveChess();
      if (!hot && tickN % 5 !== 0) return;
      enqueue(async () => {
        if (pendingFlappy) await flushFlappy($);
        else await refresh($);
      }).catch((err) => noteError($, err));
    });
    try {
      await $.command.register({
        name: "session",
        description: "Open Session. Pick Chess or Flappy, then prompt to start.",
        argumentHint: "[chess|flappy|stop]",
      });
    } catch {
      /* a taken name must not block the rest of startup */
    }
    return next(e);
  });

  on("command.run", { command: "session" }, async ($, e) => {
    const arg = String(e.args || "").trim().toLowerCase();
    if (arg === "stop") {
      paneOpen = false;
      $.ui.status(undefined);
      await $.ui.close({ id: PANE });
      return {};
    }
    if (arg === "chess" || arg === "flappy") game = arg;
    await openPane($);
    enqueue(() => refresh($)).catch((err) => noteError($, err));
    return {};
  });

  on("ui.render", { component: "Pane" }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e);
    return renderPane($, $.ui.resolve(e));
  });

  on("ui.message", async ($, e, next) => {
    if (e.element !== "board" && e.element !== "flappy-board") return next(e);
    const data = e.data && typeof e.data === "object" ? e.data : {};
    if (data.kind === "square" && /^[a-h][1-8]$/.test(String(data.sq))) {
      onSquare($, String(data.sq));
    } else if (data.kind === "flappy-score" && data.contestId) {
      const score = Math.floor(Number(data.score));
      if (score >= 0 && score <= 9999) {
        pendingFlappy = { contestId: String(data.contestId), score };
        enqueue(() => flushFlappy($)).catch((err) => noteError($, err));
      }
    }
    return next(e);
  });

  on("ui.close", async ($, e, next) => {
    if (e.id === PANE) paneOpen = false;
    return next(e);
  });

  on("prompt.submit", async ($, e, next) => {
    try {
      if (!paneOpen) await openPane($);
      await enqueue(() => startFromPrompt($));
    } catch (err) {
      noteError($, err);
    }
    return next(e);
  });
}
