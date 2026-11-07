import { useEffect, useMemo, useRef, useState } from "react";
import { Chessboard } from "react-chessboard";
import type { ChessState, PresenceSnapshot } from "./types";
import { Mark } from "./Mark";
import { FlappyTable } from "./FlappyTable";
import { WalletPanel } from "./WalletPanel";

const RELAY_HTTP = import.meta.env.VITE_RELAY_HTTP ?? "";

function fmtMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function short(value: string, head = 10, tail = 4): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function resultLine(match: ChessState): string | null {
  const result = match.result;
  if (!result) return null;
  if (result.kind === "draw") return `Draw, ${result.reason}`;
  const side =
    result.winner === match.white ? "White" : result.winner === match.black ? "Black" : "Winner";
  return `${side} wins, ${result.reason}`;
}

export function App() {
  const [snap, setSnap] = useState<PresenceSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [boardWidth, setBoardWidth] = useState(360);
  const boardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`${RELAY_HTTP}/presence`);
        if (!res.ok) throw new Error(`Relay answered ${res.status}`);
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

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const apply = () => setBoardWidth(Math.max(240, Math.floor(el.clientWidth)));
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, [activeMatch]);

  const told = activeMatch ? resultLine(activeMatch) : null;

  return (
    <div className="page">
      <header className="mast">
        <a className="brand" href="/">
          <Mark />
          <span className="word">session</span>
        </a>
        <p className={error ? "relay down" : "relay"}>{error ?? "Live"}</p>
      </header>

      <h1 className="lede">
        While the agents
        <br />
        are working.
      </h1>
      <p className="deck">
        Flappy is played here. Chess and puzzles are the battle in the editor. The winner
        gets token credits for the prompt.
      </p>

      <FlappyTable />

      <div className="ledger">
        <section>
          <h2>Session</h2>
          {!snap?.peers.length && <div className="empty">No one is here.</div>}
          {snap?.peers.map((p) => (
            <div className="person" key={p.id}>
              <div>
                <div className="name">{p.ensName ?? p.displayName}</div>
                <div className="id" title={p.id}>
                  {p.id}
                </div>
              </div>
              <div className="meta">
                <span className={p.host}>{p.host}</span>
                {p.nearby && <span>nearby</span>}
                {p.roomCode && <span className="code">{p.roomCode}</span>}
              </div>
            </div>
          ))}
        </section>

        <section>
          <h2>Rooms</h2>
          {!snap?.rooms.length && <div className="empty">No open rooms.</div>}
          {snap?.rooms.map((r) => (
            <div className="room" key={r.code}>
              <span className="code">{r.code}</span>
              <span className="id">
                {r.members.length} {r.members.length === 1 ? "member" : "members"}
              </span>
            </div>
          ))}
        </section>

        <section>
          <h2>Pings</h2>
          {!snap?.recentPings.length && <div className="empty">Nothing has crossed yet.</div>}
          {snap?.recentPings
            .slice()
            .reverse()
            .map((p) => (
              <div className="ping" key={p.id}>
                <div className="ping-line">
                  <strong>{p.fromName}</strong>
                  <time dateTime={new Date(p.at).toISOString()}>
                    {new Date(p.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </time>
                </div>
                <p>{p.text}</p>
                <div className="id" title={p.to}>
                  to {short(p.to, 12, 4)}
                </div>
              </div>
            ))}
        </section>
      </div>

      <div className="split">
        <section>
          <h2>Board</h2>
          {!activeMatch && <div className="empty">No match on the board.</div>}
          {activeMatch && (
            <>
              <div className="board-wrap" ref={boardRef}>
                <Chessboard
                  position={activeMatch.fen}
                  arePiecesDraggable={false}
                  boardWidth={boardWidth}
                  customBoardStyle={{ borderRadius: "2px", boxShadow: "none" }}
                  customLightSquareStyle={{ backgroundColor: "#f3efe6", color: "#8d7d6b" }}
                  customDarkSquareStyle={{ backgroundColor: "#6e5744", color: "#f3efe6" }}
                  customNotationStyle={{ fontFamily: "system-ui, sans-serif", fontSize: "11px" }}
                />
              </div>
              <div className="facts">
                <div className="fact">
                  <span>Match</span>
                  <strong className="mono" title={activeMatch.matchId}>
                    {short(activeMatch.matchId, 8, 4)}
                  </strong>
                </div>
                <div className="fact">
                  <span>Status</span>
                  <strong>{activeMatch.status.replaceAll("_", " ")}</strong>
                </div>
                <div className="fact">
                  <span>Turn</span>
                  <strong>
                    {activeMatch.turn === "w" ? "White" : "Black"} · {fmtMs(activeMatch.clocksMs.w)} /{" "}
                    {fmtMs(activeMatch.clocksMs.b)}
                  </strong>
                </div>
                {told && (
                  <div className="fact">
                    <span>Result</span>
                    <strong>{told}</strong>
                  </div>
                )}
              </div>
              {(activeMatch.lockTx || activeMatch.ccipMessageId || activeMatch.payoutTx) && (
                <div className="links">
                  {activeMatch.lockTx && (
                    <a
                      href={`https://sepolia.basescan.org/tx/${activeMatch.lockTx}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      lock {short(activeMatch.lockTx, 8, 4)}
                    </a>
                  )}
                  {activeMatch.ccipMessageId && (
                    <a
                      href={`https://ccip.chain.link/msg/${activeMatch.ccipMessageId}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      ccip {short(activeMatch.ccipMessageId, 8, 4)}
                    </a>
                  )}
                  {activeMatch.payoutTx && (
                    <a
                      href={`https://sepolia.etherscan.io/tx/${activeMatch.payoutTx}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      payout {short(activeMatch.payoutTx, 8, 4)}
                    </a>
                  )}
                </div>
              )}
            </>
          )}
        </section>

        <section>
          <h2>Stake</h2>
          <WalletPanel match={activeMatch} />
        </section>
      </div>
    </div>
  );
}
