/**
 * Local flappy. One tick is one frame on this machine; nothing is sent until
 * the round ends. The course comes from a shared seed so both players fly the
 * same pipes. Physics follow the MIT flappy mod by Seza Akgün (cc-arcade):
 * https://github.com/davila7/claude-code-templates/tree/main/cli-tool/components/mods/games/flappy
 */

export const BIRD_X = 4;
export const BOARD_W = 24;
export const BOARD_H = 10;

const GRAVITY = 0.15;
const FLAP_V = -0.9;
const MAX_FALL = 0.8;
const SPACING = 12;

export function gapSize(h) {
  return Math.max(3, Math.floor(h / 3));
}

function randomGap(h, rand) {
  return 1 + Math.floor(rand() * Math.max(1, h - gapSize(h) - 1));
}

/** Deterministic 0..1 stream. Both panes use the relay's seed. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function newFlappy(w, h, rand) {
  return {
    w,
    h,
    y: h / 2,
    vy: 0,
    pipes: [{ x: w - 1, gap: randomGap(h, rand) }],
    score: 0,
    over: false,
  };
}

export function flap(game) {
  if (game.over) return game;
  return { ...game, vy: FLAP_V };
}

export function birdRow(game) {
  return Math.round(game.y);
}

function pull(box) {
  let a = (box.state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  box.state = a >>> 0;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** A round as plain numbers, so the surface can keep it in local state. */
export function beginRound(seed) {
  const box = { state: seed >>> 0 };
  return { game: newFlappy(BOARD_W, BOARD_H, () => pull(box)), rng: box.state };
}

export function stepRound(game, rng) {
  const box = { state: rng >>> 0 };
  return { game: tick(game, () => pull(box)), rng: box.state };
}

export function tick(game, rand) {
  if (game.over) return game;
  let vy = Math.min(MAX_FALL, game.vy + GRAVITY);
  let y = game.y + vy;
  if (y < 0) {
    y = 0;
    vy = 0;
  }
  let pipes = game.pipes.map((pipe) => ({ ...pipe, x: pipe.x - 1 })).filter((pipe) => pipe.x >= 0);
  const last = pipes[pipes.length - 1];
  if (!last || last.x <= game.w - 1 - SPACING) {
    pipes = [...pipes, { x: game.w - 1, gap: randomGap(game.h, rand) }];
  }
  const score = game.score + pipes.filter((pipe) => pipe.x === BIRD_X - 1).length;
  const row = Math.round(y);
  const opening = gapSize(game.h);
  const hit =
    row >= game.h ||
    pipes.some((pipe) => pipe.x === BIRD_X && (row < pipe.gap || row >= pipe.gap + opening));
  return { ...game, y, vy, pipes, score, over: hit };
}
