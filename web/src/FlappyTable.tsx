import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  BIRD_X,
  BOARD_H,
  BOARD_W,
  TICK_MS,
  beginRound,
  birdRow,
  flap,
  gapSize,
  stepRound,
  type FlappyGame,
  type FlappyRound,
} from "./flappy";
import type { FlappyView, SessionId } from "./types";

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

function resultLine(view: FlappyView | null, game: FlappyGame | null): string {
  if (!view) return "Same course. Higher score wins.";
  if (view.status === "waiting" || view.seeking) return "Waiting for another player.";
  if (view.status === "playing" && !game) return "Same course. Space flaps.";
  if (view.winner === "you" && (game?.over || view.status === "done")) return `You win ${view.you} to ${view.them}`;
  if (view.winner === "them" && (game?.over || view.status === "done")) {
    return `${view.themName || "They"} wins ${view.them} to ${view.you}`;
  }
  if (view.winner === "draw" && (game?.over || view.status === "done")) return `Draw · ${view.you} each`;
  if (game?.over || (view.you != null && view.status === "playing")) {
    const scored = game?.score ?? view.you;
    if (game?.over || view.you != null) {
      if (game && !game.over) return `Score ${game.score}`;
      return `You scored ${scored}. Waiting for ${view.themName || "them"}.`;
    }
  }
  if (game) return `Score ${game.score}`;
  return "Waiting.";
}

function paint(canvas: HTMLCanvasElement, game: FlappyGame | null) {
  const cssW = canvas.clientWidth;
  if (cssW < 10) return;
  const cssH = (cssW * BOARD_H) / BOARD_W;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pxW = Math.floor(cssW * dpr);
  const pxH = Math.floor(cssH * dpr);
  if (canvas.width !== pxW || canvas.height !== pxH) {
    canvas.width = pxW;
    canvas.height = pxH;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#1f1d19";
  ctx.fillRect(0, 0, cssW, cssH);
  if (!game) return;
  const cellW = cssW / game.w;
  const cellH = cssH / game.h;
  const opening = gapSize(game.h);
  ctx.fillStyle = "#6e5744";
  for (const pipe of game.pipes) {
    const x = pipe.x * cellW;
    ctx.fillRect(x, 0, cellW + 0.5, pipe.gap * cellH);
    const bottom = (pipe.gap + opening) * cellH;
    ctx.fillRect(x, bottom, cellW + 0.5, cssH - bottom);
  }
  const row = Math.max(0, Math.min(game.h - 1, birdRow(game)));
  ctx.fillStyle = game.over ? "#9a4030" : "#f4f1ea";
  ctx.beginPath();
  ctx.arc(
    BIRD_X * cellW + cellW / 2,
    row * cellH + cellH / 2,
    Math.min(cellW, cellH) * 0.36,
    0,
    Math.PI * 2,
  );
  ctx.fill();
}

export function FlappyTable() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const roundRef = useRef<FlappyRound | null>(null);
  const viewRef = useRef<FlappyView | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const postedRef = useRef<string | null>(null);
  const contestRef = useRef<string | null>(null);
  const [name, setName] = useState("bird");
  const [joined, setJoined] = useState(false);
  const [view, setView] = useState<FlappyView | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [line, setLine] = useState("Same course. Higher score wins.");
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [rematchOffer, setRematchOffer] = useState<{ waiting?: boolean; fromName?: string } | null>(null);

  function syncHud(nextView: FlappyView | null, game: FlappyGame | null) {
    setLine(resultLine(nextView, game));
    setScore(game ? game.score : nextView?.you ?? null);
  }

  function applyView(next: FlappyView) {
    viewRef.current = next;
    setView(next);
    if (next.status === "waiting" || !next.id) {
      roundRef.current = null;
      contestRef.current = null;
      postedRef.current = null;
      syncHud(next, null);
      return;
    }
    if (next.status === "playing" && contestRef.current !== next.id) {
      roundRef.current = beginRound(next.seed);
      contestRef.current = next.id;
      postedRef.current = null;
    }
    syncHud(next, roundRef.current?.game ?? null);
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      const canvas = canvasRef.current;
      const round = roundRef.current;
      if (round && !round.game.over) {
        const stepped = stepRound(round.game, round.rng);
        roundRef.current = stepped;
        if (stepped.game.score !== round.game.score || stepped.game.over) {
          syncHud(viewRef.current, stepped.game);
        }
        if (stepped.game.over) {
          const contest = viewRef.current;
          const ws = wsRef.current;
          if (
            contest &&
            contest.id &&
            postedRef.current !== contest.id &&
            ws &&
            ws.readyState === WebSocket.OPEN
          ) {
            postedRef.current = contest.id;
            ws.send(
              JSON.stringify({ type: "flappy_score", contestId: contest.id, score: stepped.game.score }),
            );
          }
        }
      }
      if (canvas) paint(canvas, roundRef.current?.game ?? null);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (!roundRef.current || roundRef.current.game.over) return;
      const key = event.key.toLowerCase();
      if (key !== " " && key !== "arrowup" && key !== "w") return;
      event.preventDefault();
      roundRef.current = { ...roundRef.current, game: flap(roundRef.current.game) };
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  function play(event: FormEvent) {
    event.preventDefault();
    setError(null);
    wsRef.current?.close();
    roundRef.current = null;
    postedRef.current = null;
    viewRef.current = null;
    setView(null);
    setScore(null);
    const ws = new WebSocket(relayWs());
    wsRef.current = ws;
    const id = newId();
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "hello",
          identity: {
            id,
            displayName: name.trim().slice(0, 18) || "bird",
            host: "web",
          },
        }),
      );
    };
    ws.onmessage = (ev) => {
      let msg: {
        type: string;
        flappy?: FlappyView;
        message?: string;
        bank?: { balanceUsd?: string };
        offer?: { waiting?: boolean; fromName?: string } | null;
      };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.type === "welcome") {
        ws.send(JSON.stringify({ type: "flappy_join" }));
        setJoined(true);
      } else if (msg.type === "flappy" && msg.flappy) {
        if (msg.flappy.balanceUsd) setBalance(msg.flappy.balanceUsd);
        if (msg.flappy.status === "playing") setRematchOffer(null);
        applyView(msg.flappy);
      } else if (msg.type === "bank" && msg.bank?.balanceUsd) {
        setBalance(msg.bank.balanceUsd);
      } else if (msg.type === "rematch") {
        setRematchOffer(msg.offer ?? null);
      } else if (msg.type === "error" && msg.message) {
        setError(msg.message);
      }
    };
    ws.onerror = () => setError("Could not reach the relay.");
    const heart = window.setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "heartbeat" }));
    }, 5000);
    ws.onclose = () => {
      window.clearInterval(heart);
      if (wsRef.current === ws) wsRef.current = null;
    };
  }

  function flapNow(event?: ReactPointerEvent) {
    event?.preventDefault();
    const round = roundRef.current;
    if (!round || round.game.over) return;
    roundRef.current = { ...round, game: flap(round.game) };
  }

  function again() {
    roundRef.current = null;
    postedRef.current = null;
    setScore(null);
    setRematchOffer(null);
    wsRef.current?.send(JSON.stringify({ type: "flappy_join" }));
  }

  function rematch() {
    wsRef.current?.send(JSON.stringify({ type: "rematch", game: "flappy" }));
  }

  const done = view?.status === "done" || Boolean(roundRef.current?.game.over && view?.winner);

  return (
    <section className="panel flappy-panel">
      <div className="flappy-intro">
        <h2>Flappy</h2>
        <p>Same course for both. The relay says who scored higher.</p>
      </div>

      {!joined && (
        <form className="flappy-join" onSubmit={play}>
          <label>
            Name
            <input value={name} maxLength={18} onChange={(event) => setName(event.target.value)} />
          </label>
          <button className="primary" type="submit">
            Play
          </button>
        </form>
      )}

      {joined && (
        <div className="flappy-layout">
          <canvas
            ref={canvasRef}
            className="flappy-canvas"
            aria-label="Flappy"
            onPointerDown={flapNow}
          />
          <aside className="flappy-side">
            <div className="room-code">{score ?? "–"}</div>
            <div className="flappy-status">{line}</div>
            {view?.them != null && <div className="hint">{view.themName || "Them"} {view.them}</div>}
            {done && balance && balance !== "$0.00" && (
              <div className="hint">Balance {balance}. Claim it whenever you want.</div>
            )}
            <div className="actions">
              <button type="button" onClick={() => flapNow()}>
                Flap
              </button>
              {(view?.status === "done" || done) && (
                <>
                  <button type="button" className="primary" onClick={rematch}>
                    {rematchOffer?.waiting ? "Waiting for rematch…" : rematchOffer ? "Accept rematch" : "Rematch"}
                  </button>
                  <button type="button" onClick={again}>
                    New opponent
                  </button>
                </>
              )}
            </div>
          </aside>
        </div>
      )}

      {error && <p className="flappy-error">{error}</p>}
    </section>
  );
}
