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

function drawArena(canvas: HTMLCanvasElement, match: SnakeState, selfId: string | null) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const css = canvas.clientWidth;
  if (css < 10) return;
  const dpr = window.devicePixelRatio || 1;
  const px = Math.floor(css * dpr);
  if (canvas.width !== px || canvas.height !== px) {
    canvas.width = px;
    canvas.height = px;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cell = css / match.width;
  ctx.fillStyle = "#070b10";
  ctx.fillRect(0, 0, css, css);
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 1;
  for (let i = 1; i < match.width; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cell + 0.5, 0);
    ctx.lineTo(i * cell + 0.5, css);
    ctx.stroke();
  }
  for (let i = 1; i < match.height; i++) {
    ctx.beginPath();
    ctx.moveTo(0, i * cell + 0.5);
    ctx.lineTo(css, i * cell + 0.5);
    ctx.stroke();
  }

  for (const pellet of match.pellets) {
    const radius = (pellet.value > 1 ? 0.3 : 0.16) * cell;
    ctx.save();
    ctx.shadowColor = pellet.value > 1 ? "#fde68a" : "#fbbf24";
    ctx.shadowBlur = 14;
    ctx.fillStyle = pellet.value > 1 ? "#fde68a" : "#fbbf24";
    ctx.beginPath();
    ctx.arc(pellet.x * cell + cell / 2, pellet.y * cell + cell / 2, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  for (const player of match.players) {
    player.body.forEach((seg, index) => {
      const head = index === 0;
      ctx.save();
      ctx.globalAlpha = player.alive ? 1 : 0.4;
      ctx.fillStyle = player.color;
      if (head) {
        ctx.shadowColor = player.color;
        ctx.shadowBlur = player.boost ? 18 : 8;
      }
      ctx.beginPath();
      ctx.arc(
        seg.x * cell + cell / 2,
        seg.y * cell + cell / 2,
        (head ? 0.46 : 0.36) * cell,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.restore();
    });

    const head = player.body[0];
    if (!head) continue;
    const cx = head.x * cell + cell / 2;
    const cy = head.y * cell + cell / 2;
    if (player.alive) {
      const ox = player.dir === "left" ? -1 : player.dir === "right" ? 1 : 0;
      const oy = player.dir === "up" ? -1 : player.dir === "down" ? 1 : 0;
      const px = -oy;
      const py = ox;
      ctx.fillStyle = "#071018";
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
    ctx.font = `600 ${Math.max(11, cell * 0.72)}px "IBM Plex Sans", sans-serif`;
    ctx.textAlign = "center";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.65)";
    ctx.strokeText(player.name, cx, cy - cell * 0.72);
    ctx.fillStyle = player.id === selfId ? "#ffffff" : "rgba(232,238,246,0.9)";
    ctx.fillText(player.name, cx, cy - cell * 0.72);
  }
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
  const [box, setBox] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const live = useRef<{ ws: WebSocket; heart: number } | null>(null);
  const matchRef = useRef<SnakeState | null>(null);
  const myIdRef = useRef<SessionId | null>(null);
  const dirRef = useRef<SnakeDir | null>(null);
  const boostRef = useRef(false);

  useEffect(() => {
    matchRef.current = match;
  }, [match]);

  useEffect(() => {
    if (match?.status !== "active") return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [match?.status]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox(el.clientWidth));
    ro.observe(el);
    setBox(el.clientWidth);
    return () => ro.disconnect();
  }, [playing]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !match) return;
    drawArena(canvas, match, myId);
  }, [match, myId, box]);

  function closeSocket() {
    const cur = live.current;
    if (!cur) return;
    window.clearInterval(cur.heart);
    cur.ws.onclose = null;
    cur.ws.close();
    live.current = null;
  }

  function sendSteer(dir: SnakeDir | null, boost: boolean) {
    const ws = live.current?.ws;
    const current = matchRef.current;
    const heading =
      dir ?? current?.players.find((player) => player.id === myIdRef.current)?.dir ?? null;
    if (!ws || ws.readyState !== WebSocket.OPEN || !current || !heading) return;
    if (dir) dirRef.current = dir;
    boostRef.current = boost;
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
      if (event.code === "Space") {
        event.preventDefault();
        sendSteer(dirRef.current, true);
        return;
      }
      const dir = keyDir(event.key);
      if (!dir) return;
      event.preventDefault();
      sendSteer(dir, boostRef.current);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      sendSteer(dirRef.current, false);
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
    boostRef.current = false;
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
        setMatch(msg.match);
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
        <p>
          A shared arena on the relay. Eat the orbs, don't touch a body or the wall, and hold
          boost to sprint. Highest score after 90 seconds wins. Leave the room blank and
          everyone who hits Play shares one arena. A code starts or joins a private one.
        </p>
        {import.meta.env.DEV && (
          <p className="hint">
            This arena uses the local relay on port 47831. The lobby below is the public relay.
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
