import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, watch } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";
import { BoardPanel } from "./boardPanel";
import { Credits } from "./credits";
import type { GameId } from "./prefs";
import { GAME_IDS, PrefsStore, isEvmAddress } from "./prefs";
import { RelayBridge } from "./relayBridge";
import { SidebarProvider } from "./sidebarProvider";

let bridge: RelayBridge | undefined;

export async function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration("session");
  const relayUrl = config.get<string>("relayUrl") ?? "wss://sessionrelay-production.up.railway.app/ws";
  const displayName =
    config.get<string>("displayName") ||
    process.env.SESSION_DISPLAY_NAME ||
    "cursor";

  // Unique per extension-host process (each Cursor window). Do not use
  // workspaceState/globalState — those are shared when both windows open the
  // same folder, which caused connect/disconnect flapping on the relay.
  const instanceId = `${process.pid.toString(16)}${randomBytes(2).toString("hex")}`;

  bridge = new RelayBridge(relayUrl, displayName, instanceId);
  const prefs = new PrefsStore(context);
  if (prefs.get().onboarded && !context.globalState.get("session.addedFlappy")) {
    const games = prefs.get().games.filter((game) => game !== "flappy");
    await prefs.update({ games: [...games, "flappy"] });
    await context.globalState.update("session.addedFlappy", true);
  }
  if (prefs.get().onboarded && !context.globalState.get("session.addedMate")) {
    if (!prefs.get().games.includes("mate")) {
      await prefs.update({ games: [...prefs.get().games, "mate"] });
    }
    await context.globalState.update("session.addedMate", true);
  }

  const credits = new Credits(() => prefs.get().wallet);
  const saved = prefs.get();
  if (isEvmAddress(saved.wallet)) {
    bridge.setPlayer(saved.wallet as `0x${string}`, saved.chainId);
  }
  const openBoard = (game?: GameId) => {
    if (!bridge) return;
    BoardPanel.show(bridge, prefs, credits, game);
  };

  const sidebar = new SidebarProvider(context.extensionUri, bridge, prefs, credits, openBoard);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebar, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("session.connect", async () => {
      try {
        await bridge!.connect();
        vscode.window.setStatusBarMessage("Session: connected to relay", 3000);
      } catch (err) {
        vscode.window.showErrorMessage(
          `Session: could not reach relay at ${relayUrl}. Start it with: pnpm --filter @session/relay start`,
        );
      }
    }),
    vscode.commands.registerCommand("session.openBoard", openBoard),
    vscode.commands.registerCommand("session.createRoom", () => bridge?.createRoom()),
    vscode.commands.registerCommand("session.refresh", () => {
      bridge?.poll();
      sidebar.refresh();
    }),
  );

  // Auto-connect so the sidebar is live after reload
  bridge.connect().catch(() => {
    vscode.window.showWarningMessage(
      "Session: relay not reachable. Run the relay, then Session: Connect to relay.",
    );
  });

  // When a match starts, open the board tab automatically
  let sawMatchId: string | null = null;
  let sawFlappyId: string | null = null;
  let sawFlappyResult: string | null = null;
  let rewardedMatch: string | null = null;
  bridge.onChange((state) => {
    const id = state.match?.matchId ?? null;
    if (id && id !== sawMatchId && state.match?.status !== "finished") {
      sawMatchId = id;
      if (prefs.get().games.includes("chess")) openBoard("chess");
      vscode.window.setStatusBarMessage(`Session: match ${id} started`, 4000);
    }
    if (!id) sawMatchId = null;
    const flapId = state.flappy?.status === "playing" ? state.flappy.id : null;
    if (flapId && prefs.get().games.includes("flappy") && flapId !== sawFlappyId) {
      sawFlappyId = flapId;
      openBoard("flappy");
      vscode.window.setStatusBarMessage("Session: flappy", 4000);
    }
    if (state.flappy?.status === "done" && state.flappy.id && state.flappy.id !== sawFlappyResult) {
      sawFlappyResult = state.flappy.id;
      const flap = state.flappy;
      const stake = flap.stake ? ` ${flap.stake}` : "";
      const line =
        flap.winner === "draw"
          ? `Session: flappy draw ${flap.you}`
          : flap.winner === "you"
            ? `Session: you win ${flap.you} to ${flap.them}.${stake}`
            : `Session: ${flap.themName || "they"} wins ${flap.them} to ${flap.you}.${stake}`;
      vscode.window.setStatusBarMessage(line, 6000);
    }
    const result = state.match?.result as { kind?: string; winner?: string } | undefined;
    if (
      state.match &&
      state.match.status === "finished" &&
      result?.kind === "win" &&
      result.winner &&
      result.winner === state.me?.id &&
      state.match.matchId !== rewardedMatch
    ) {
      rewardedMatch = state.match.matchId;
      const awarded = credits.award("chess", state.match.matchId);
      if (awarded.cents > 0) {
        vscode.window.setStatusBarMessage(`Session: ${awarded.note}`, 5000);
      }
    }
  });

  const sessionDir = join(homedir(), ".session");
  mkdirSync(sessionDir, { recursive: true });
  const triggerPath = join(sessionDir, "puzzle-trigger.json");
  let lastTrigger = 0;
  const onPrompt = () => {
    if (!bridge) return;
    try {
      const raw = JSON.parse(readFileSync(triggerPath, "utf8")) as {
        at?: number;
        game?: string;
        room?: string;
      };
      if (!raw.at || raw.at <= lastTrigger) return;
      const gameName = raw.game === "snakes" ? "flappy" : raw.game;
      if (!gameName || !(GAME_IDS as readonly string[]).includes(gameName)) return;
      lastTrigger = raw.at;
      const picked = prefs.get();
      if (!picked.onboarded) return;
      const game = gameName as GameId;
      const panel = BoardPanel.show(bridge, prefs, credits);
      if (game === "chess" && picked.multiplayer) {
        const match = bridge.state.match;
        if (!match || match.status === "finished") bridge.next();
      }
      if (game === "flappy") {
        bridge.flappyJoin();
        vscode.window.setStatusBarMessage("Session: flappy", 4000);
      } else {
        vscode.window.setStatusBarMessage(`Session: ${game} from your prompt`, 3000);
      }
      panel.deal(game);
    } catch {
      /* trigger file not written yet */
    }
  };
  const promptWatch = watch(sessionDir, () => {
    credits.sync();
    onPrompt();
  });
  context.subscriptions.push({
    dispose: () => {
      promptWatch.close();
      bridge?.disconnect();
    },
  });
}

export function deactivate() {
  bridge?.disconnect();
  bridge = undefined;
}
