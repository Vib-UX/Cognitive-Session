import Bonjour, { type Service } from "bonjour-service";
import type { SessionIdentity } from "./types.js";

const SERVICE_TYPE = "session";

export interface NearbyPeer {
  id: string;
  displayName: string;
  host: string;
}

/**
 * Advertise this session on the LAN and browse for other Session peers.
 * Discovery only — all game traffic still goes through the relay.
 */
export class NearbyDiscovery {
  private bonjour = new Bonjour();
  private service: Service | null = null;
  private browser: ReturnType<Bonjour["find"]> | null = null;
  private peers = new Map<string, NearbyPeer>();

  start(identity: SessionIdentity, port = 47832): void {
    this.stop();

    this.service = this.bonjour.publish({
      name: `session-${identity.id}`,
      type: SERVICE_TYPE,
      port,
      txt: {
        id: identity.id,
        name: identity.displayName,
        host: identity.host,
        ens: identity.ensName ?? "",
      },
    });

    this.browser = this.bonjour.find({ type: SERVICE_TYPE }, (service) => {
      const id = service.txt?.id;
      if (!id || id === identity.id) return;
      this.peers.set(id, {
        id,
        displayName: service.txt?.name ?? id,
        host: service.txt?.host ?? "unknown",
      });
    });

    this.browser.on("down", (service: Service) => {
      const id = service.txt?.id;
      if (id) this.peers.delete(id);
    });
  }

  nearbyIds(): Set<string> {
    return new Set(this.peers.keys());
  }

  list(): NearbyPeer[] {
    return [...this.peers.values()];
  }

  stop(): void {
    try {
      this.service?.stop();
    } catch {
      /* ignore */
    }
    this.service = null;
    try {
      this.browser?.stop();
    } catch {
      /* ignore */
    }
    this.browser = null;
    this.peers.clear();
    try {
      this.bonjour.destroy();
    } catch {
      /* ignore */
    }
    this.bonjour = new Bonjour();
  }
}
