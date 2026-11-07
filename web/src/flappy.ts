/**
 * Same course as the Claude mod. One tick is one frame. Nothing is sent until
 * the round ends. Physics follow packages/claude-mod/hooks/flappy.js.
 */

export const BIRD_X = 4;
export const BOARD_W = 24;
export const BOARD_H = 10;
export const TICK_MS = 100;

const GRAVITY = 0.15;
const FLAP_V = -0.9;
const MAX_FALL = 0.8;
const SPACING = 12;

export interface Pipe {
  x: number;
  gap: number;
}

export interface FlappyGame {
  w: number;
  h: number;
  y: number;
  vy: number;
  pipes: Pipe[];
  score: number;
  over: boolean;
}

export interface FlappyRound {
  game: FlappyGame;
  rng: number;
}

export function gapSize(h: number): number {
  return Math.max(3, Math.floor(h / 3));
}

function randomGap(h: number, rand: () => number): number {
  return 1 + Math.floor(rand() * Math.max(1, h - gapSize(h) - 1));
}

function pull(box: { state: number }): number {
  let a = (box.state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  box.state = a >>> 0;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function newFlappy(w: number, h: number, rand: () => number): FlappyGame {
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

export function flap(game: FlappyGame): FlappyGame {
  if (game.over) return game;
  return { ...game, vy: FLAP_V };
}

export function birdRow(game: FlappyGame): number {
  return Math.round(game.y);
}

export function beginRound(seed: number): FlappyRound {
  const box = { state: seed >>> 0 };
  return { game: newFlappy(BOARD_W, BOARD_H, () => pull(box)), rng: box.state };
}

export function stepRound(game: FlappyGame, rng: number): FlappyRound {
  const box = { state: rng >>> 0 };
  return { game: tick(game, () => pull(box)), rng: box.state };
}

export function tick(game: FlappyGame, rand: () => number): FlappyGame {
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
