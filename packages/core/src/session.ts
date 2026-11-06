import { ArkivLobby } from "./arkiv.js";
import { attachLocalEns } from "./ens-local.js";
import { loadOrCreateIdentity, saveIdentity } from "./identity.js";
import { NearbyDiscovery } from "./mdns.js";
import { RelayClient } from "./relay-client.js";
import type {
  ChallengeInfo,
  ChessState,
  HostKind,
  PeerInfo,
  PingMessage,
  RoomInfo,
  SessionIdentity,
} from "./types.js";

export interface SessionOptions {
  host: HostKind;
  displayName?: string;
  relayUrl?: string;
  enableMdns?: boolean;
  attachEnsName?: boolean;
}

/**
 * High-level Session client used by both the Cursor plugin and the Claude mod.
 */
export class SessionClient {
  readonly identity: SessionIdentity;
  readonly relay: RelayClient;
  readonly nearby: NearbyDiscovery;
  private mdnsEnabled: boolean;

  readonly arkiv: ArkivLobby;

  constructor(opts: SessionOptions) {
    this.identity = loadOrCreateIdentity(opts.host, opts.displayName);
    if (opts.attachEnsName !== false) {
      attachLocalEns(this.identity);
    }
    const url =
      opts.relayUrl ??
      process.env.SESSION_RELAY_URL ??
      "wss://sessionrelay-production.up.railway.app/ws";
    this.relay = new RelayClient(url, this.identity);
    this.nearby = new NearbyDiscovery();
    this.mdnsEnabled = opts.enableMdns !== false;
    this.arkiv = new ArkivLobby();

    this.relay.on((msg) => {
      if (msg.type === "peers" || msg.type === "welcome" || msg.type === "poll_state") {
        this.annotateNearby();
      }
    });
  }

  async start(): Promise<void> {
    if (this.mdnsEnabled) {
      try {
        this.nearby.start(this.identity);
      } catch (err) {
        console.error("[session] mDNS unavailable:", err);
      }
    }
    await this.relay.connect();
    this.annotateNearby();
  }

  stop(): void {
    this.nearby.stop();
    this.relay.disconnect();
  }

  private annotateNearby(): void {
    const ids = this.nearby.nearbyIds();
    this.relay.peers = this.relay.peers.map((p) => ({
      ...p,
      nearby: ids.has(p.id),
    }));
  }

  me(): SessionIdentity {
    return this.identity;
  }

  peers(): PeerInfo[] {
    this.annotateNearby();
    return this.relay.peers.filter((p) => p.id !== this.identity.id);
  }

  room(): RoomInfo | null {
    return this.relay.room;
  }

  pings(): PingMessage[] {
    return this.relay.pings;
  }

  match(): ChessState | null {
    return this.relay.match;
  }

  snake() {
    return this.relay.snake;
  }

  challenges(): ChallengeInfo[] {
    return this.relay.challenges;
  }

  async createRoom(): Promise<RoomInfo> {
    const msg = await this.relay.createRoomAsync();
    if (msg.type !== "room" || !msg.room) throw new Error("Failed to create room");
    return msg.room;
  }

  async joinRoom(code: string): Promise<RoomInfo> {
    const msg = await this.relay.joinRoomAsync(code);
    if (msg.type !== "room" || !msg.room) throw new Error(`Failed to join room ${code}`);
    return msg.room;
  }

  async ping(to: PeerInfo["id"], text: string): Promise<PingMessage> {
    const msg = await this.relay.pingAsync(to, text);
    if (msg.type !== "ping") throw new Error("Ping failed");
    return msg.message;
  }

  poll() {
    this.relay.poll();
    return {
      me: this.identity,
      peers: this.peers(),
      room: this.room(),
      pings: this.pings(),
      match: this.match(),
      snake: this.snake(),
      challenges: this.challenges(),
      nearby: this.nearby.list(),
    };
  }

  setEnsName(ensName: string): void {
    this.identity.ensName = ensName;
    saveIdentity(this.identity);
  }

  setWallet(address: `0x${string}`): void {
    this.identity.walletAddress = address;
    saveIdentity(this.identity);
  }
}
