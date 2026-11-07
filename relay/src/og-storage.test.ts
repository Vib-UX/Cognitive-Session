import assert from "node:assert/strict";
import test from "node:test";
import { matchRecord, storeFinishedMatch } from "./og-storage.js";
import type { ChessState } from "./types.js";

function finishedMatch(): ChessState {
  return {
    matchId: "match_0g",
    roomCode: "ROOM",
    white: "sess_white",
    black: "sess_black",
    fen: "8/8/8/8/8/8/8/8 w - - 0 1",
    turn: "w",
    clocksMs: { w: 0, b: 0 },
    lastMoveAt: 0,
    status: "finished",
    result: { kind: "win", winner: "sess_white", reason: "checkmate" },
    ccipMessageId: "0xccip",
  };
}

test("a finished match record keeps the players, result, and CCIP id", () => {
  const record = matchRecord(finishedMatch());
  assert.equal(record.white, "sess_white");
  assert.equal(record.black, "sess_black");
  assert.deepEqual(record.result, { kind: "win", winner: "sess_white", reason: "checkmate" });
  assert.equal(record.ccipMessageId, "0xccip");
});

test("0G upload stays off unless a key is configured", async () => {
  const previous = process.env.SESSION_0G_PRIVATE_KEY;
  delete process.env.SESSION_0G_PRIVATE_KEY;
  try {
    assert.equal(await storeFinishedMatch(finishedMatch()), null);
    assert.equal(await storeFinishedMatch({ ...finishedMatch(), status: "active" }), null);
  } finally {
    if (previous === undefined) delete process.env.SESSION_0G_PRIVATE_KEY;
    else process.env.SESSION_0G_PRIVATE_KEY = previous;
  }
});
