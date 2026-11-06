export type SessionId = `sess_${string}`;

export interface SessionIdentity {
  id: SessionId;
  displayName: string;
  host: "cursor" | "claude";
  ensName?: string;
  walletAddress?: `0x${string}`;
  chainId?: number;
}

export interface PeerInfo {
  id: SessionId;
  displayName: string;
  host: string;
  nearby: boolean;
  roomCode: string | null;
  ensName?: string;
  lastSeen: number;
  waiting?: boolean;
}

export interface RoomInfo {
  code: string;
  members: SessionId[];
  createdAt: number;
  matchId: string | null;
}

export interface PingMessage {
  id: string;
  from: SessionId;
  fromName: string;
  to: SessionId;
  text: string;
  at: number;
}

export interface ChessState {
  matchId: string;
  roomCode: string;
  white: SessionId;
  black: SessionId;
  fen: string;
  turn: "w" | "b";
  clocksMs: { w: number; b: number };
  lastMoveAt: number;
  status: "pending_deposit" | "active" | "finished";
  result?: unknown;
  stakeWei?: string;
  drawWord?: string;
}

export type SnakeDir = "up" | "down" | "left" | "right";

export interface SnakeState {
  matchId: string;
  roomCode: string;
  width: number;
  height: number;
  tick: number;
  players: {
    id: SessionId;
    name: string;
    color: string;
    body: { x: number; y: number }[];
    dir: SnakeDir;
    pendingDir: SnakeDir;
    alive: boolean;
    connected: boolean;
    score: number;
    boost: boolean;
  }[];
  pellets: { id: number; x: number; y: number; value: number }[];
  status: "waiting" | "active" | "finished";
  endsAt: number | null;
  result?: {
    kind: "win" | "draw";
    winner?: SessionId;
    reason: string;
    scores: { id: SessionId; name: string; score: number }[];
  };
}

export interface ChallengeInfo {
  id: string;
  from: SessionId;
  fromName: string;
  to: SessionId;
  stakeWei: string;
  createdAt: number;
  expiresAt: number;
}

export type ServerMessage =
  | { type: "welcome"; identity: SessionIdentity; peers: PeerInfo[]; room: RoomInfo | null }
  | { type: "peers"; peers: PeerInfo[] }
  | { type: "room"; room: RoomInfo | null }
  | { type: "ping"; message: PingMessage }
  | { type: "challenge"; challenge: ChallengeInfo }
  | { type: "challenge_resolved"; challengeId: string; accepted: boolean; match?: ChessState }
  | { type: "match"; match: ChessState }
  | { type: "queue"; seeking: boolean; waiting: number; drawing?: boolean }
  | { type: "error"; message: string; scope?: "reward" }
  | { type: "reward"; txHash: string; chainId: number; amount: string; chainName: string }
  | {
      type: "poll_state";
      peers: PeerInfo[];
      room: RoomInfo | null;
      pings: PingMessage[];
      match: ChessState | null;
      challenges: ChallengeInfo[];
      snake?: SnakeState | null;
    }
  | { type: "snake"; match: SnakeState };

export interface UiState {
  connected: boolean;
  me: SessionIdentity | null;
  peers: PeerInfo[];
  room: RoomInfo | null;
  pings: PingMessage[];
  match: ChessState | null;
  snake: SnakeState | null;
  challenges: ChallengeInfo[];
  error: string | null;
  /** This window pressed Next and is waiting for a partner or a draw. */
  seeking: boolean;
  /** Paired, waiting for the Base VRF word before the board opens. */
  drawing: boolean;
  /** Other sessions already waiting for Next. */
  waiting: number;
}
