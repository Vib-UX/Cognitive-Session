import assert from "node:assert/strict";
import { test } from "node:test";
import { beginRound, flap, stepRound } from "./hooks/flappy.js";

function fly(seed) {
  let round = beginRound(seed);
  for (let i = 0; i < 50 && !round.game.over; i++) {
    if (i % 7 === 0) round = { ...round, game: flap(round.game) };
    const stepped = stepRound(round.game, round.rng);
    round = { ...round, game: stepped.game, rng: stepped.rng };
  }
  return {
    score: round.game.score,
    over: round.game.over,
    y: round.game.y,
    pipes: round.game.pipes,
  };
}

test("the same seed flies the same course", () => {
  assert.deepEqual(fly(7), fly(7));
});

test("a different seed is a different course", () => {
  assert.notDeepEqual(fly(7), fly(8));
});

test("the ceiling does not end the round and the floor does", () => {
  let round = beginRound(3);
  let guarded = 0;
  while (!round.game.over && guarded < 200) {
    const stepped = stepRound(round.game, round.rng);
    round = { ...round, game: stepped.game, rng: stepped.rng };
    guarded += 1;
  }
  assert.equal(round.game.over, true);
  assert.ok(round.game.y >= round.game.h - 1);
});
