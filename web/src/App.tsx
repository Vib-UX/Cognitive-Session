import { useEffect, useMemo, useState } from "react";
import { Chessboard } from "react-chessboard";
import type { PresenceSnapshot } from "./types";
import { SnakeArena } from "./SnakeArena";
import { WalletPanel } from "./WalletPanel";

const RELAY_HTTP = import.meta.env.VITE_RELAY_HTTP ?? "";

function fmtMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function App() {
  const [snap, setSnap] = useState<PresenceSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`${RELAY_HTTP}/presence`);
        if (!res.ok) throw new Error(`presence ${res.status}`);
        const data = (await res.json()) as PresenceSnapshot;
        if (alive) {
          setSnap(data);
          setError(null);
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const activeMatch = useMemo(
    () => snap?.matches.find((m) => m.status !== "finished") ?? snap?.matches.at(-1) ?? null,
    [snap],
  );

  return (
    <>
      <div className="header">
        <div>
          <h1>Session</h1>
          <p className="sub">
            Live presence for Cursor and Claude coding sessions. Share a room, then play
            snakes or chess.
          </p>
        </div>
        <div className="live">{error ? `relay: ${error}` : "relay live"}</div>
      </div>

      <SnakeArena />

      <div className="grid">
        <section className="panel">
          <h2>Lobby</h2>
          {!snap?.peers.length && <div className="empty">No sessions online yet.</div>}
          {snap?.peers.map((p) => (
            <div className="peer" key={p.id}>
              <div>
                <div>
                  <strong>{p.ensName ?? p.displayName}</strong>
                </div>
                <div className="mono" style={{ color: "var(--muted)" }}>
                  {p.id}
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                <span className={`badge ${p.host}`}>{p.host}</span>
                {p.nearby && <span className="badge nearby">nearby</span>}
                {p.roomCode && <span className="badge room">{p.roomCode}</span>}
              </div>
            </div>
          ))}
        </section>

        <section className="panel">
          <h2>Rooms</h2>
          {!snap?.rooms.length && <div className="empty">No open rooms.</div>}
          {snap?.rooms.map((r) => (
            <div className="row" key={r.code}>
              <div>
                <div className="mono" style={{ fontSize: "1.1rem" }}>
                  {r.code}
                </div>
                <div className="mono" style={{ color: "var(--muted)" }}>
                  {r.members.length} member{r.members.length === 1 ? "" : "s"}
                  {r.matchId ? ` · ${r.matchId}` : ""}
                </div>
              </div>
            </div>
          ))}
        </section>

        <section className="panel">
          <h2>Recent pings</h2>
          {!snap?.recentPings.length && (
            <div className="empty">Join a room and ping to prove the connection.</div>
          )}
          {snap?.recentPings
            .slice()
            .reverse()
            .map((p) => (
              <div className="ping" key={p.id}>
                <div>
                  <strong>{p.fromName}</strong> → <span className="mono">{p.to}</span>
                </div>
                <div>{p.text}</div>
                <div className="meta">{new Date(p.at).toLocaleTimeString()}</div>
              </div>
            ))}
        </section>
      </div>

      <div className="grid" style={{ marginTop: "1rem" }}>
        <section className="panel">
          <h2>Board</h2>
          {!activeMatch && <div className="empty">No active chess match yet.</div>}
          {activeMatch && (
            <>
              <div className="board-wrap">
                <Chessboard position={activeMatch.fen} arePiecesDraggable={false} />
              </div>
              <div className="actions">
                <div className="stat">
                  <span>Match</span>
                  <strong className="mono">{activeMatch.matchId}</strong>
                </div>
                <div className="stat">
                  <span>Status</span>
                  <strong>{activeMatch.status}</strong>
                </div>
                <div className="stat">
                  <span>Turn</span>
                  <strong>
                    {activeMatch.turn === "w" ? "white" : "black"} · W{" "}
                    {fmtMs(activeMatch.clocksMs.w)} / B {fmtMs(activeMatch.clocksMs.b)}
                  </strong>
                </div>
              </div>
              {activeMatch.result && (
                <p style={{ marginTop: "0.75rem" }}>
                  Result:{" "}
                  <strong className="mono">{JSON.stringify(activeMatch.result)}</strong>
                </p>
              )}
              {(activeMatch.lockTx || activeMatch.ccipMessageId || activeMatch.payoutTx) && (
                <div style={{ marginTop: "0.75rem" }} className="mono">
                  {activeMatch.lockTx && <div>lock: {activeMatch.lockTx}</div>}
                  {activeMatch.ccipMessageId && <div>ccip: {activeMatch.ccipMessageId}</div>}
                  {activeMatch.payoutTx && <div>payout: {activeMatch.payoutTx}</div>}
                </div>
              )}
            </>
          )}
        </section>

        <section className="panel">
          <h2>Wager (Base → Sepolia)</h2>
          <WalletPanel match={activeMatch} />
        </section>
      </div>
    </>
  );
}
