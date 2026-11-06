export type HostKind = "cursor" | "claude";
export type SessionId = `sess_${string}`;

export interface SessionIdentity {
  id: SessionId;
  displayName: string;
  host: HostKind;
  ensName?: string;
  walletAddress?: `0x${string}`;
  chainId?: number;
}

export interface PeerInfo {
  id: SessionId;
  displayName: string;
  host: HostKind;
  nearby: boolean;
  roomCode: string | null;
  ensName?: string;
  lastSeen: number;
  /** True when this peer has hit Next and is waiting for a match. */
  waiting?: boolean;
}

export interface PingMessage {
  id: string;
  from: SessionId;
  fromName: string;
  to: SessionId;
  text: string;
  at: number;
}

export type ChessColor = "w" | "b";

export type GameResult =
  | { kind: "win"; winner: SessionId; reason: "checkmate" | "resign" | "timeout" }
  | { kind: "draw"; reason: "stalemate" | "agreement" | "timeout" };

export interface ChessState {
  matchId: string;
  roomCode: string;
  white: SessionId;
  black: SessionId;
  fen: string;
  turn: ChessColor;
  clocksMs: { w: number; b: number };
  lastMoveAt: number;
  status: "pending_deposit" | "active" | "finished";
  result?: GameResult;
  stakeWei?: string;
  lockTx?: string;
  ccipMessageId?: string;
  payoutTx?: string;
}

export interface RoomInfo {
  code: string;
  members: SessionId[];
  createdAt: number;
  matchId: string | null;
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

export type ClientMessage =
  | { type: "hello"; identity: SessionIdentity }
  | { type: "heartbeat" }
  | { type: "create_room" }
  | { type: "join_room"; code: string }
  | { type: "leave_room" }
  | { type: "ping"; to: SessionId; text: string }
  | { type: "challenge"; to: SessionId; stakeWei?: string }
  | { type: "respond_challenge"; challengeId: string; accept: boolean }
  | { type: "move"; matchId: string; uci: string }
  | { type: "resign"; matchId: string }
  | { type: "next" }
  | { type: "poll" }
  | { type: "set_match_meta"; matchId: string; lockTx?: string; ccipMessageId?: string; payoutTx?: string; status?: ChessState["status"] }
  | { type: "claim_reward"; amount: string };

export type ServerMessage =
  | { type: "welcome"; identity: SessionIdentity; peers: PeerInfo[]; room: RoomInfo | null }
  | { type: "peers"; peers: PeerInfo[] }
  | { type: "room"; room: RoomInfo | null }
  | { type: "ping"; message: PingMessage }
  | { type: "challenge"; challenge: ChallengeInfo }
  | { type: "challenge_resolved"; challengeId: string; accepted: boolean; match?: ChessState }
  | { type: "match"; match: ChessState }
  | { type: "queue"; seeking: boolean; waiting: number }
  | { type: "error"; message: string; scope?: "reward" }
  | { type: "reward"; txHash: string; chainId: number; amount: string; chainName: string }
  | {
      type: "poll_state";
      peers: PeerInfo[];
      room: RoomInfo | null;
      pings: PingMessage[];
      match: ChessState | null;
      challenges: ChallengeInfo[];
    };

export interface PresenceSnapshot {
  peers: PeerInfo[];
  rooms: RoomInfo[];
  recentPings: PingMessage[];
  matches: ChessState[];
  challenges: ChallengeInfo[];
}
