import assert from "node:assert/strict";
import { test } from "node:test";
import { legalUci, toUci } from "./dist/board.js";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const CASTLE = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
const PROMOTE = "7k/4P3/8/8/8/8/8/4K3 w - - 0 1";

test("legal moves from the start include e2e4 and not e2e5", () => {
  const moves = legalUci(START);
  assert.ok(moves.includes("e2e4"));
  assert.ok(moves.includes("g1f3"));
  assert.equal(moves.includes("e2e5"), false);
});

test("SAN and UCI both become UCI", () => {
  assert.equal(toUci(START, "e4"), "e2e4");
  assert.equal(toUci(START, "e2e4"), "e2e4");
  assert.equal(toUci(START, "Nf3"), "g1f3");
});

test("castling accepts O-O and 0-0", () => {
  assert.equal(toUci(CASTLE, "O-O"), "e1g1");
  assert.equal(toUci(CASTLE, "0-0"), "e1g1");
  assert.equal(toUci(CASTLE, "O-O-O"), "e1c1");
});

test("promotion accepts SAN and UCI", () => {
  assert.equal(toUci(PROMOTE, "e8=Q"), "e7e8q");
  assert.equal(toUci(PROMOTE, "e7e8q"), "e7e8q");
  assert.equal(toUci(PROMOTE, "e8=N"), "e7e8n");
});

test("an illegal move is rejected", () => {
  assert.throws(() => toUci(START, "e5"), /Illegal move|e5/i);
  assert.throws(() => toUci(START, ""), /Empty move/);
});
