import { useEffect, useRef, useState, type FormEvent } from "react";
import type { SessionId, SnakeDir, SnakeState } from "./types";

function relayWs(): string {
  const env = import.meta.env.VITE_RELAY_WS as string | undefined;
  if (env) return env;
  if (import.meta.env.DEV) {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/ws`;
  }
  return "wss://sessionrelay-production.up.railway.app/ws";
}

function newId(): SessionId {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sess_${hex}`;
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

function keyDir(key: string): SnakeDir | null {
  const k = key.toLowerCase();
  if (k === "arrowup" || k === "w") return "up";
  if (k === "arrowdown" || k === "s") return "down";
  if (k === "arrowleft" || k === "a") return "left";
  if (k === "arrowright" || k === "d") return "right";
  return null;
}

type Point = { x: number; y: number };

function opposite(dir: SnakeDir): SnakeDir {
  if (dir === "up") return "down";
  if (dir === "down") return "up";
  if (dir === "left") return "right";
  return "left";
}

function alignPose(prev: Point[] | undefined, next: Point[]): Point[] {
  if (!prev || prev.length === 0) return next.map((cell) => ({ x: cell.x, y: cell.y }));
  const grown = next.length - prev.length;
  if (grown === 0) return prev;
  if (grown > 0 && grown <= 2) {
    const pad = Array.from({ length: grown }, () => prev[0]!);
    return pad.concat(prev).slice(0, next.length);
  }
  if (grown < 0 && grown >= -2) return prev.slice(0, next.length);
  return next.map((cell) => ({ x: cell.x, y: cell.y }));
}

const TICK_MS = 110;
const LEAD_CELLS = 5;
const STEP: Record<SnakeDir, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

function copyBody(body: Point[]): Point[] {
  return body.map((cell) => ({ x: cell.x, y: cell.y }));
}

function stepBody(body: Point[], dir: SnakeDir): Point[] {
  const head = body[0];
  if (!head) return body;
  const delta = STEP[dir];
  const next = [{ x: head.x + delta.x, y: head.y + delta.y }, ...body];
  next.pop();
  return next;
}

function slideBody(body: Point[], dir: SnakeDir, frac: number): Point[] {
  if (frac <= 0 || body.length === 0) return body;
  const head = body[0]!;
  const delta = STEP[dir];
  const out: Point[] = [{ x: head.x + delta.x * frac, y: head.y + delta.y * frac }];
  for (let i = 1; i < body.length; i++) {
    const prev = body[i - 1]!;
    const cur = body[i]!;
    out.push({
      x: cur.x + (prev.x - cur.x) * frac,
      y: cur.y + (prev.y - cur.y) * frac,
    });
  }
  return out;
}

function leadOf(head: Point, server: Point, dir: SnakeDir): number {
  const delta = STEP[dir];
  return (head.x - server.x) * delta.x + (head.y - server.y) * delta.y;
}

type Sim = { matchId: string; body: Point[]; dir: SnakeDir; acc: number };

function reconcileSim(sim: Sim, server: Point[], dir: SnakeDir): void {
  const head = sim.body[0];
  const serverHead = server[0];
  if (!head || !serverHead) {
    sim.body = copyBody(server);
    sim.dir = dir;
    sim.acc = 0;
    return;
  }
  if (Math.hypot(head.x - serverHead.x, head.y - serverHead.y) > 4) {
    sim.body = copyBody(server);
    sim.dir = dir;
    sim.acc = 0;
    return;
  }
  const grew = server.length - sim.body.length;
  if (grew === 0) return;
  if (grew > 0 && grew <= 2) {
    const tail = sim.body[sim.body.length - 1] ?? head;
    for (let i = 0; i < grew; i++) sim.body.push({ x: tail.x, y: tail.y });
    return;
  }
  if (grew < 0 && sim.body.length + grew >= 2) {
    sim.body = sim.body.slice(0, server.length);
    return;
  }
  sim.body = copyBody(server);
  sim.acc = 0;
}

function advanceSim(sim: Sim, serverHead: Point, want: SnakeDir, boost: boolean, dt: number): Point[] {
  const hops = boost && sim.body.length > 10 ? 2 : 1;
  const maxLead = hops * LEAD_CELLS;
  sim.acc += dt;
  let guard = 0;
  while (sim.acc >= TICK_MS && sim.body[0] && guard < 4) {
    const dir = want !== opposite(sim.dir) ? want : sim.dir;
    if (leadOf(sim.body[0], serverHead, dir) >= maxLead) break;
    sim.dir = dir;
    sim.acc -= TICK_MS;
    guard += 1;
    for (let hop = 0; hop < hops; hop++) sim.body = stepBody(sim.body, sim.dir);
  }
  if (sim.acc > TICK_MS) sim.acc = TICK_MS;
  const head = sim.body[0];
  const frac = head && leadOf(head, serverHead, sim.dir) >= maxLead ? 0 : Math.min(sim.acc / TICK_MS, 1);
  return slideBody(sim.body, sim.dir, frac);
}

function extrapolate(body: Point[], dir: SnakeDir, ageMs: number): Point[] {
  const extra = Math.min(Math.max(0, ageMs) / TICK_MS, 1.6);
  let pts = copyBody(body);
  const whole = Math.floor(extra);
  for (let i = 0; i < whole; i++) pts = stepBody(pts, dir);
  return slideBody(pts, dir, extra - whole);
}

function easePose(prev: Point[] | undefined, next: Point[], dt: number): Point[] {
  const aligned = alignPose(prev, next);
  const slow = 1 - Math.exp(-dt / 36);
  const fast = 1 - Math.exp(-dt / 16);
  return next.map((cell, index) => {
    const cur = aligned[index];
    if (!cur) return { x: cell.x, y: cell.y };
    const dx = cell.x - cur.x;
    const dy = cell.y - cur.y;
    const dist = dx * dx + dy * dy;
    if (dist > 64) return { x: cell.x, y: cell.y };
    const k = dist > 6.25 ? fast : slow;
    return { x: cur.x + dx * k, y: cur.y + dy * k };
  });
}

let gridCache: { key: string; canvas: HTMLCanvasElement } | null = null;

function gridLayer(css: number, width: number, height: number): HTMLCanvasElement {
  const key = `${css}x${width}x${height}`;
  if (gridCache?.key === key) return gridCache.canvas;
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(css);
  canvas.height = Math.floor(css);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const step = css / width;
    ctx.strokeStyle = "rgba(250,249,245,0.055)";
    ctx.beginPath();
    for (let i = 1; i < width; i++) {
      const x = Math.round(i * step) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, css);
    }
    for (let i = 1; i < height; i++) {
      const y = Math.round(i * step) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(css, y);
    }
    ctx.stroke();
  }
  gridCache = { key, canvas };
  return canvas;
}

function drawArena(
  canvas: HTMLCanvasElement,
  match: SnakeState,
  poses: Map<string, Point[]>,
  selfId: string | null,
  facing: SnakeDir | null,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const css = canvas.clientWidth;
  if (css < 10) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const px = Math.floor(css * dpr);
  if (canvas.width !== px || canvas.height !== px) {
    canvas.width = px;
    canvas.height = px;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, css, css);
  ctx.fillStyle = "#1f1d19";
  ctx.fillRect(0, 0, css, css);
  ctx.drawImage(gridLayer(css, match.width, match.height), 0, 0, css, css);
  const cell = css / match.width;

  for (const pellet of match.pellets) {
    ctx.fillStyle = pellet.value > 1 ? "#f0e6d6" : "#e07a5f";
    ctx.beginPath();
    ctx.arc(
      pellet.x * cell + cell / 2,
      pellet.y * cell + cell / 2,
      (pellet.value > 1 ? 0.28 : 0.16) * cell,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  for (const player of match.players) {
    const body = poses.get(player.id);
    if (!body || body.length === 0) continue;
    ctx.globalAlpha = player.alive ? 1 : 0.4;
    ctx.strokeStyle = player.color;
    ctx.fillStyle = player.color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = cell * 0.72;
    if (body.length > 1) {
      ctx.beginPath();
      ctx.moveTo(body[0]!.x * cell + cell / 2, body[0]!.y * cell + cell / 2);
      for (let i = 1; i < body.length; i++) {
        const seg = body[i]!;
        ctx.lineTo(seg.x * cell + cell / 2, seg.y * cell + cell / 2);
      }
      ctx.stroke();
    }
    const head = body[0]!;
    const cx = head.x * cell + cell / 2;
    const cy = head.y * cell + cell / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.42, 0, Math.PI * 2);
    ctx.fill();
    const dir =
      player.id === selfId && facing && facing !== opposite(player.dir) ? facing : player.dir;
    if (player.alive) {
      const ox = dir === "left" ? -1 : dir === "right" ? 1 : 0;
      const oy = dir === "up" ? -1 : dir === "down" ? 1 : 0;
      const px = -oy;
      const py = ox;
      ctx.fillStyle = "#1f1d19";
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(
          cx + ox * cell * 0.1 + px * side * cell * 0.16,
          cy + oy * cell * 0.1 + py * side * cell * 0.16,
          cell * 0.07,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    if (cell < 8) continue;
    ctx.font = `500 ${Math.max(11, cell * 0.7)}px Newsreader, "Iowan Old Style", Palatino, serif`;
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(250,249,245,0.92)";
    ctx.fillText(player.name, cx, cy - cell * 0.7);
  }
}

function viewSig(match: SnakeState): string {
  return [
    match.tick,
    match.status,
    match.players.map((player) => `${player.id}:${player.score}:${player.alive ? 1 : 0}`).join(","),
  ].join("|");
}

export function SnakeArena() {
  const [name, setName] = useState("snake");
  const [code, setCode] = useState("");
  const [playing, setPlaying] = useState(false);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [match, setMatch] = useState<SnakeState | null>(null);
  const [myId, setMyId] = useState<SessionId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const live = useRef<{ ws: WebSocket; heart: number } | null>(null);
  const matchRef = useRef<SnakeState | null>(null);
  const myIdRef = useRef<SessionId | null>(null);
  const dirRef = useRef<SnakeDir | null>(null);
  const facingRef = useRef<SnakeDir | null>(null);
  const boostRef = useRef(false);
  const pressedRef = useRef<SnakeDir[]>([]);
  const posesRef = useRef<Map<string, Point[]>>(new Map());
  const simRef = useRef<Sim | null>(null);
  const arrivedRef = useRef(0);
  const sigRef = useRef("");
  const sentSteer = useRef("");

  useEffect(() => {
    if (match?.status !== "active") return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [match?.status]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = 0;
    const loop = (nowMs: number) => {
      frame = window.requestAnimationFrame(loop);
      const canvas = canvasRef.current;
      const current = matchRef.current;
      if (!canvas || !current) return;
      const dt = last ? Math.min(48, nowMs - last) : 16;
      last = nowMs;
      const poses = posesRef.current;
      const seen = new Set<string>();
      const age = arrivedRef.current ? nowMs - arrivedRef.current : 0;
      for (const player of current.players) {
        seen.add(player.id);
        const mine = player.id === myIdRef.current;
        if (player.body.length === 0 || !player.alive) {
          if (mine) simRef.current = null;
          poses.delete(player.id);
          continue;
        }
        if (mine) {
          const want =
            facingRef.current && facingRef.current !== opposite(player.dir) ? facingRef.current : player.dir;
          let sim = simRef.current;
          if (!sim || sim.matchId !== current.matchId) {
            sim = { matchId: current.matchId, body: copyBody(player.body), dir: want, acc: 0 };
          } else {
            reconcileSim(sim, player.body, player.dir);
          }
          simRef.current = sim;
          const serverHead = player.body[0];
          if (!serverHead) continue;
          poses.set(player.id, advanceSim(sim, serverHead, want, boostRef.current, dt));
          continue;
        }
        const target = extrapolate(player.body, player.dir, age);
        poses.set(player.id, easePose(poses.get(player.id), target, dt));
      }
      for (const id of [...poses.keys()]) if (!seen.has(id)) poses.delete(id);
      drawArena(canvas, current, poses, myIdRef.current, facingRef.current);
    };
    frame = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(frame);
  }, [playing]);

  function closeSocket() {
    const cur = live.current;
    if (!cur) return;
    window.clearInterval(cur.heart);
    cur.ws.onclose = null;
    cur.ws.close();
    live.current = null;
  }

  function rememberKey(dir: SnakeDir, down: boolean): SnakeDir | null {
    const list = pressedRef.current;
    const at = list.indexOf(dir);
    if (down) {
      if (at >= 0) list.splice(at, 1);
      list.push(dir);
    } else if (at >= 0) list.splice(at, 1);
    return list[list.length - 1] ?? null;
  }

  function sendSteer(dir: SnakeDir | null, boost: boolean) {
    const heading = dir ?? dirRef.current;
    if (heading) {
      dirRef.current = heading;
      facingRef.current = heading;
    }
    boostRef.current = boost;
    const ws = live.current?.ws;
    const current = matchRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !current || !heading) return;
    const stamp = `${current.matchId}:${heading}:${boost ? 1 : 0}`;
    if (sentSteer.current === stamp) return;
    sentSteer.current = stamp;
    ws.send(
      JSON.stringify({
        type: "snake_steer",
        matchId: current.matchId,
        dir: heading,
        boost,
      }),
    );
  }

  useEffect(() => {
    if (!playing) return;
    const down = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return;
      }
      if (event.repeat) return;
      if (event.code === "Space") {
        event.preventDefault();
        sendSteer(dirRef.current, true);
        return;
      }
      const dir = keyDir(event.key);
      if (!dir) return;
      event.preventDefault();
      const next = rememberKey(dir, true);
      if (next) sendSteer(next, boostRef.current);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        sendSteer(dirRef.current, false);
        return;
      }
      const dir = keyDir(event.key);
      if (!dir) return;
      const next = rememberKey(dir, false);
      if (next) sendSteer(next, boostRef.current);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [playing]);

  function play(event: FormEvent) {
    event.preventDefault();
    closeSocket();
    setError(null);
    setMatch(null);
    setRoomCode(null);
    dirRef.current = null;
    facingRef.current = null;
    boostRef.current = false;
    pressedRef.current = [];
    posesRef.current = new Map();
    simRef.current = null;
    arrivedRef.current = 0;
    sigRef.current = "";
    sentSteer.current = "";
    const id = newId();
    myIdRef.current = id;
    setMyId(id);
    const ws = new WebSocket(relayWs());
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "hello",
          identity: {
            id,
            displayName: name.trim().slice(0, 18) || "snake",
            host: "web",
          },
        }),
      );
    };
    ws.onmessage = (ev) => {
      let msg: {
        type: string;
        room?: { code: string } | null;
        match?: SnakeState;
        message?: string;
      };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.type === "welcome") {
        const room = code.trim().toUpperCase();
        ws.send(JSON.stringify(room ? { type: "snake_join", code: room } : { type: "snake_join" }));
      } else if (msg.type === "room" && msg.room) {
        setRoomCode(msg.room.code);
      } else if (msg.type === "snake" && msg.match) {
        matchRef.current = msg.match;
        arrivedRef.current = performance.now();
        const sig = viewSig(msg.match);
        if (sig !== sigRef.current) {
          sigRef.current = sig;
          setMatch(msg.match);
        }
        if (dirRef.current) sendSteer(dirRef.current, boostRef.current);
      } else if (msg.type === "error" && msg.message) {
        setError(msg.message);
      }
    };
    ws.onerror = () => setError("Could not reach the relay. Start it with pnpm --filter @session/relay start.");
    ws.onclose = () => {
      setPlaying(false);
      live.current = null;
    };
    const heart = window.setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "heartbeat" }));
    }, 5000);
    live.current = { ws, heart };
    setPlaying(true);
  }

  function leave() {
    const ws = live.current?.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "snake_leave" }));
    }
    closeSocket();
    setPlaying(false);
    setMatch(null);
    setRoomCode(null);
  }

  function again() {
    live.current?.ws.send(JSON.stringify({ type: "snake_join" }));
  }

  const me = match?.players.find((player) => player.id === myId) ?? null;
  const ranked = [...(match?.players ?? [])].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const headline = !match
    ? "Connecting"
    : match.status === "waiting"
      ? "Waiting for another snake"
      : match.status === "finished"
        ? match.result?.kind === "draw"
          ? "Draw"
          : `${match.players.find((player) => player.id === match.result?.winner)?.name ?? "Someone"} wins${
              match.result?.reason === "last" ? " — last one in" : ""
            }`
        : `${fmt((match.endsAt ?? now) - now)} left${me && !me.alive ? " · respawning" : ""}`;

  return (
    <section className="panel snake-panel">
      <div className="snake-intro">
        <h2>Snakes</h2>
        <p>Blank code joins the open arena. Arrows to turn, space to sprint.</p>
        {import.meta.env.DEV && (
          <p className="hint">
            This table is the local relay. The list below is the public one.
          </p>
        )}
      </div>

      {!playing && (
        <form className="snake-join" onSubmit={play}>
          <label>
            Name
            <input value={name} maxLength={18} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            Room code
            <input
              value={code}
              placeholder="Blank joins the open arena"
              maxLength={8}
              autoCapitalize="characters"
              onChange={(event) => setCode(event.target.value.toUpperCase())}
            />
          </label>
          <button className="primary" type="submit">
            Play
          </button>
        </form>
      )}

      {playing && (
        <div className="snake-layout">
          <div ref={wrapRef}>
            <canvas ref={canvasRef} className="snake-canvas" aria-label="Snake arena" />
            <div className="dpad">
              <button type="button" className="up" onClick={() => sendSteer("up", boostRef.current)}>
                ↑
              </button>
              <button type="button" className="left" onClick={() => sendSteer("left", boostRef.current)}>
                ←
              </button>
              <button
                type="button"
                className="boost"
                onPointerDown={(event) => {
                  event.preventDefault();
                  sendSteer(dirRef.current, true);
                }}
                onPointerUp={() => sendSteer(dirRef.current, false)}
                onPointerLeave={() => {
                  if (boostRef.current) sendSteer(dirRef.current, false);
                }}
              >
                boost
              </button>
              <button type="button" className="right" onClick={() => sendSteer("right", boostRef.current)}>
                →
              </button>
              <button type="button" className="down" onClick={() => sendSteer("down", boostRef.current)}>
                ↓
              </button>
            </div>
            <p className="hint">Arrows or WASD to turn. Hold space to boost.</p>
          </div>
          <aside className="snake-side">
            <div className="room-code">{roomCode ?? "····"}</div>
            <div className="snake-status">{headline}</div>
            <ol className="scores">
              {ranked.map((player) => (
                <li key={player.id} className={player.id === myId ? "me" : ""}>
                  <i style={{ background: player.color }} />
                  <span>{player.name}</span>
                  <strong>{player.score}</strong>
                </li>
              ))}
            </ol>
            <div className="actions">
              {match?.status === "finished" && (
                <button className="primary" type="button" onClick={again}>
                  Play again
                </button>
              )}
              <button type="button" onClick={leave}>
                Leave
              </button>
            </div>
          </aside>
        </div>
      )}
      {error && <p className="snake-error">{error}</p>}
    </section>
  );
}
