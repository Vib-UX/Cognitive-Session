import { randomBytes } from "node:crypto";
import type { SessionId, SnakeDir, SnakePlayer, SnakePoint, SnakeState } from "./types.js";

export const SNAKE_WIDTH = 48;
export const SNAKE_HEIGHT = 48;
export const SNAKE_TICK_MS = 110;
export const SNAKE_ROUND_MS = 90_000;
export const SNAKE_START_LEN = 4;
export const SNAKE_MAX_PLAYERS = 16;
export const PUBLIC_SNAKE_ROOM = "OPEN";
export const SNAKE_MAX_LEN = 120;
export const SNAKE_RESPAWN_MS = 2_000;
export const SNAKE_PELLETS = 42;
const BOOST_MIN = 10;

const COLORS = [
  "#5eead4",
  "#fb7185",
  "#7dd3fc",
  "#c4b5fd",
  "#4ade80",
  "#f0abfc",
  "#fdba74",
  "#93c5fd",
];

const DELTA: Record<SnakeDir, SnakePoint> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const SPAWNS: { x: number; y: number; dir: SnakeDir }[] = [
  { x: 8, y: 24, dir: "right" },
  { x: 39, y: 24, dir: "left" },
  { x: 24, y: 8, dir: "down" },
  { x: 24, y: 39, dir: "up" },
  { x: 12, y: 12, dir: "down" },
  { x: 35, y: 12, dir: "down" },
  { x: 12, y: 35, dir: "up" },
  { x: 35, y: 35, dir: "up" },
];

export function opposite(dir: SnakeDir): SnakeDir {
  if (dir === "up") return "down";
  if (dir === "down") return "up";
  if (dir === "left") return "right";
  return "left";
}

function resolveDir(current: SnakeDir, pending: SnakeDir): SnakeDir {
  return pending === opposite(current) ? current : pending;
}

function trail(x: number, y: number, dir: SnakeDir, len: number): SnakePoint[] {
  const back = DELTA[opposite(dir)];
  const cells: SnakePoint[] = [];
  let cx = x;
  let cy = y;
  for (let i = 0; i < len; i++) {
    cells.push({ x: cx, y: cy });
    cx += back.x;
    cy += back.y;
  }
  return cells;
}

function inBounds(state: SnakeState, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < state.width && y < state.height;
}

function livingAt(state: SnakeState, x: number, y: number, ignoreTail: boolean): boolean {
  for (const player of state.players) {
    if (!player.alive) continue;
    const last = ignoreTail ? Math.max(0, player.body.length - 1) : player.body.length;
    for (let i = 0; i < last; i++) {
      const cell = player.body[i]!;
      if (cell.x === x && cell.y === y) return true;
    }
  }
  return false;
}

function spawnClear(state: SnakeState, x: number, y: number, dir: SnakeDir): boolean {
  const cells = trail(x, y, dir, SNAKE_START_LEN);
  return cells.every((cell) => inBounds(state, cell.x, cell.y) && !livingAt(state, cell.x, cell.y, false));
}

function findSpawn(state: SnakeState, rng: () => number): { x: number; y: number; dir: SnakeDir } {
  for (const slot of SPAWNS) {
    if (spawnClear(state, slot.x, slot.y, slot.dir)) return slot;
  }
  for (let i = 0; i < 40; i++) {
    const x = 2 + Math.floor(rng() * (state.width - 4));
    const y = 2 + Math.floor(rng() * (state.height - 4));
    const dir: SnakeDir = "right";
    if (spawnClear(state, x, y, dir)) return { x, y, dir };
  }
  return SPAWNS[state.players.length % SPAWNS.length]!;
}

function placePellet(state: SnakeState, rng: () => number): boolean {
  for (let i = 0; i < 30; i++) {
    const x = Math.floor(rng() * state.width);
    const y = Math.floor(rng() * state.height);
    if (livingAt(state, x, y, false)) continue;
    if (state.pellets.some((pellet) => pellet.x === x && pellet.y === y)) continue;
    state.pelletSeq += 1;
    state.pellets.push({
      id: state.pelletSeq,
      x,
      y,
      value: rng() < 0.12 ? 3 : 1,
    });
    return true;
  }
  return false;
}

function refill(state: SnakeState, rng: () => number): void {
  let guard = 0;
  while (state.pellets.length < SNAKE_PELLETS && guard < SNAKE_PELLETS) {
    guard += 1;
    if (!placePellet(state, rng)) break;
  }
}

export function createSnakeMatch(roomCode: string, rng: () => number = Math.random): SnakeState {
  const state: SnakeState = {
    matchId: `snake_${randomBytes(4).toString("hex")}`,
    roomCode,
    width: SNAKE_WIDTH,
    height: SNAKE_HEIGHT,
    tick: 0,
    pelletSeq: 0,
    players: [],
    pellets: [],
    status: "waiting",
    startedAt: null,
    endsAt: null,
  };
  refill(state, rng);
  return state;
}

function clearPelletsUnder(state: SnakeState, cells: SnakePoint[]): void {
  const keys = new Set(cells.map((cell) => `${cell.x},${cell.y}`));
  state.pellets = state.pellets.filter((pellet) => !keys.has(`${pellet.x},${pellet.y}`));
}

export function joinSnake(
  state: SnakeState,
  id: SessionId,
  name: string,
  now: number,
  rng: () => number = Math.random,
): void {
  const clean = name.replace(/[\r\n\t]/g, " ").trim().slice(0, 18) || "snake";
  const existing = state.players.find((player) => player.id === id);
  if (existing) {
    existing.connected = true;
    existing.name = clean;
    if (!existing.alive && existing.deadAt == null) existing.deadAt = now;
    return;
  }
  if (state.status === "finished") throw new Error("Match finished");
  if (state.players.length >= SNAKE_MAX_PLAYERS) throw new Error("Arena is full");

  const spawn = findSpawn(state, rng);
  const body = trail(spawn.x, spawn.y, spawn.dir, SNAKE_START_LEN);
  clearPelletsUnder(state, body);
  const player: SnakePlayer = {
    id,
    name: clean,
    color: COLORS[state.players.length % COLORS.length]!,
    body,
    dir: spawn.dir,
    pendingDir: spawn.dir,
    alive: true,
    connected: true,
    score: 0,
    boost: false,
    deadAt: null,
  };
  state.players.push(player);

  const connected = state.players.filter((p) => p.connected).length;
  if (state.status === "waiting" && connected >= 2) {
    state.status = "active";
    state.startedAt = now;
    state.endsAt = now + SNAKE_ROUND_MS;
  }
}

export function setSnakeHeading(
  state: SnakeState,
  id: SessionId,
  dir: SnakeDir,
  boost = false,
): void {
  const player = state.players.find((p) => p.id === id);
  if (!player) throw new Error("Not in this snake match");
  player.pendingDir = dir;
  player.boost = player.alive && boost;
}

function kill(state: SnakeState, player: SnakePlayer, now: number): void {
  if (!player.alive) return;
  player.alive = false;
  player.boost = false;
  player.deadAt = now;
  const body = player.body;
  player.body = [];
  for (let i = 0; i < body.length; i += 2) {
    if (state.pellets.length >= 80) break;
    const cell = body[i]!;
    if (livingAt(state, cell.x, cell.y, false)) continue;
    if (state.pellets.some((pellet) => pellet.x === cell.x && pellet.y === cell.y)) continue;
    state.pelletSeq += 1;
    state.pellets.push({ id: state.pelletSeq, x: cell.x, y: cell.y, value: 1 });
  }
}

function blocked(state: SnakeState, x: number, y: number, selfId: SessionId): boolean {
  for (const player of state.players) {
    if (!player.alive) continue;
    const last = Math.max(0, player.body.length - 1);
    for (let i = 0; i < last; i++) {
      if (player.id === selfId && i === 0) continue;
      const cell = player.body[i]!;
      if (cell.x === x && cell.y === y) return true;
    }
  }
  return false;
}

function planned(player: SnakePlayer): { x: number; y: number; dir: SnakeDir } {
  const dir = resolveDir(player.dir, player.pendingDir);
  const delta = DELTA[dir];
  const head = player.body[0]!;
  return { x: head.x + delta.x, y: head.y + delta.y, dir };
}

function step(state: SnakeState, player: SnakePlayer, now: number): void {
  if (!player.alive || player.body.length === 0) return;
  const next = planned(player);
  player.dir = next.dir;
  player.pendingDir = next.dir;
  if (!inBounds(state, next.x, next.y) || blocked(state, next.x, next.y, player.id)) {
    kill(state, player, now);
    return;
  }
  const pelletIndex = state.pellets.findIndex((pellet) => pellet.x === next.x && pellet.y === next.y);
  const grow = pelletIndex >= 0;
  if (grow) {
    const pellet = state.pellets[pelletIndex]!;
    player.score += pellet.value;
    state.pellets.splice(pelletIndex, 1);
  }
  player.body.unshift({ x: next.x, y: next.y });
  if (!grow) player.body.pop();
  if (player.body.length > SNAKE_MAX_LEN) player.body.pop();
}

function moveGroup(state: SnakeState, now: number, include: (player: SnakePlayer) => boolean): void {
  const group = state.players.filter((player) => player.alive && player.body.length > 0 && include(player));
  const buckets = new Map<string, SnakePlayer[]>();
  for (const player of group) {
    const next = planned(player);
    if (!inBounds(state, next.x, next.y)) continue;
    const key = `${next.x},${next.y}`;
    const list = buckets.get(key) ?? [];
    list.push(player);
    buckets.set(key, list);
  }
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    for (const player of list) kill(state, player, now);
  }
  for (const player of group) step(state, player, now);
}

function shed(state: SnakeState, player: SnakePlayer): void {
  if (player.body.length <= BOOST_MIN) return;
  const tail = player.body.pop();
  if (!tail) return;
  if (state.pellets.some((pellet) => pellet.x === tail.x && pellet.y === tail.y)) return;
  state.pelletSeq += 1;
  state.pellets.push({ id: state.pelletSeq, x: tail.x, y: tail.y, value: 1 });
}

function respawn(state: SnakeState, now: number, rng: () => number): void {
  for (const player of state.players) {
    if (!player.connected || player.alive || player.deadAt == null) continue;
    if (now - player.deadAt < SNAKE_RESPAWN_MS) continue;
    const spawn = findSpawn(state, rng);
    if (!spawnClear(state, spawn.x, spawn.y, spawn.dir)) continue;
    const body = trail(spawn.x, spawn.y, spawn.dir, SNAKE_START_LEN);
    clearPelletsUnder(state, body);
    player.body = body;
    player.dir = spawn.dir;
    player.pendingDir = resolveDir(spawn.dir, player.pendingDir);
    player.alive = true;
    player.boost = false;
    player.deadAt = null;
  }
}

function scoreRows(state: SnakeState): { id: SessionId; name: string; score: number }[] {
  return [...state.players]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map((player) => ({ id: player.id, name: player.name, score: player.score }));
}

export function finishSnake(state: SnakeState, reason: "score" | "last", now: number): void {
  if (state.status === "finished") return;
  state.status = "finished";
  state.endsAt = now;
  const scores = scoreRows(state);
  if (reason === "last") {
    const survivor = state.players.find((player) => player.connected);
    state.result = survivor
      ? { kind: "win", winner: survivor.id, reason, scores }
      : { kind: "draw", reason, scores };
    return;
  }
  const top = scores[0];
  const second = scores[1];
  if (!top || (second && top.score === second.score)) {
    state.result = { kind: "draw", reason, scores };
    return;
  }
  state.result = { kind: "win", winner: top.id, reason, scores };
}

/** Advance the arena one tick. Mutates `state`. */
export function tickSnake(state: SnakeState, now = Date.now(), rng: () => number = Math.random): void {
  if (state.status !== "active") return;
  if (state.endsAt != null && now >= state.endsAt) {
    finishSnake(state, "score", now);
    return;
  }
  moveGroup(state, now, () => true);
  moveGroup(state, now, (player) => player.boost && player.body.length > BOOST_MIN);
  if (state.tick % 2 === 0) {
    for (const player of state.players) {
      if (player.alive && player.boost && player.body.length > BOOST_MIN) shed(state, player);
    }
  }
  respawn(state, now, rng);
  refill(state, rng);
  state.tick += 1;
}

/** Drop a player. Returns `remove` when the arena has nobody left. */
export function disconnectSnake(state: SnakeState, id: SessionId, now: number): "remove" | "ok" {
  const player = state.players.find((p) => p.id === id);
  if (!player || !player.connected) return "ok";
  if (state.status !== "active") {
    state.players = state.players.filter((p) => p.id !== id);
    return state.players.length === 0 ? "remove" : "ok";
  }
  player.connected = false;
  player.boost = false;
  if (player.alive) kill(state, player, now);
  const connected = state.players.filter((p) => p.connected).length;
  if (connected === 0) return "remove";
  if (connected === 1) finishSnake(state, "last", now);
  return "ok";
}
