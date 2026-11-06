import { Chess } from "chess.js";
import { randomBytes } from "node:crypto";
import type { ChessState, GameResult, SessionId } from "./types.js";

export const DEFAULT_CLOCK_MS = 2 * 60 * 1000;

export function createMatch(
  roomCode: string,
  a: SessionId,
  b: SessionId,
  stakeWei = "0",
  opening?: { whiteIsA: boolean; word: string },
): ChessState {
  const whiteIsA = opening ? opening.whiteIsA : Math.random() < 0.5;
  const white = whiteIsA ? a : b;
  const black = white === a ? b : a;
  const chess = new Chess();
  const needsDeposit = stakeWei !== "0";
  return {
    matchId: `match_${randomBytes(4).toString("hex")}`,
    roomCode,
    white,
    black,
    fen: chess.fen(),
    turn: "w",
    clocksMs: { w: DEFAULT_CLOCK_MS, b: DEFAULT_CLOCK_MS },
    lastMoveAt: Date.now(),
    status: needsDeposit ? "pending_deposit" : "active",
    stakeWei,
    drawWord: opening?.word,
  };
}

function deductClock(match: ChessState): ChessState {
  if (match.status !== "active") return match;
  const now = Date.now();
  const elapsed = now - match.lastMoveAt;
  const side = match.turn;
  const remaining = match.clocksMs[side] - elapsed;
  if (remaining <= 0) {
    const winner = side === "w" ? match.black : match.white;
    const result: GameResult = { kind: "win", winner, reason: "timeout" };
    return {
      ...match,
      clocksMs: { ...match.clocksMs, [side]: 0 },
      status: "finished",
      result,
      lastMoveAt: now,
    };
  }
  return {
    ...match,
    clocksMs: { ...match.clocksMs, [side]: remaining },
    lastMoveAt: now,
  };
}

export function applyMove(match: ChessState, player: SessionId, uci: string): ChessState {
  let next = deductClock(match);
  if (next.status === "finished") return next;
  if (next.status !== "active") throw new Error("Match is not active");

  const expected = next.turn === "w" ? next.white : next.black;
  if (player !== expected) throw new Error("Not your turn");

  const chess = new Chess(next.fen);
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.length > 4 ? uci[4] : undefined;
  const move = chess.move({ from, to, promotion });
  if (!move) throw new Error(`Illegal move: ${uci}`);

  next = {
    ...next,
    fen: chess.fen(),
    turn: chess.turn(),
    lastMoveAt: Date.now(),
  };

  if (chess.isCheckmate()) {
    next = {
      ...next,
      status: "finished",
      result: { kind: "win", winner: player, reason: "checkmate" },
    };
  } else if (chess.isDraw() || chess.isStalemate()) {
    next = {
      ...next,
      status: "finished",
      result: { kind: "draw", reason: "stalemate" },
    };
  }

  return next;
}

export function applyResign(match: ChessState, player: SessionId): ChessState {
  if (match.status === "finished") return match;
  const winner = player === match.white ? match.black : match.white;
  return {
    ...match,
    status: "finished",
    result: { kind: "win", winner, reason: "resign" },
    lastMoveAt: Date.now(),
  };
}

export function checkTimeout(match: ChessState): ChessState {
  return deductClock(match);
}
