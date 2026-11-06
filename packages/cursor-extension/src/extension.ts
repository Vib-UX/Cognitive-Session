import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, watch } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";
import { BoardPanel } from "./boardPanel";
import { Credits } from "./credits";
import type { GameId } from "./prefs";
import { GAME_IDS, PrefsStore } from "./prefs";
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
  if (prefs.get().onboarded && !context.globalState.get("session.addedSnakes")) {
    if (!prefs.get().games.includes("snakes")) {
      await prefs.update({ games: [...prefs.get().games, "snakes"] });
    }
    await context.globalState.update("session.addedSnakes", true);
  }
  if (prefs.get().onboarded && !context.globalState.get("session.addedMate")) {
    if (!prefs.get().games.includes("mate")) {
      await prefs.update({ games: [...prefs.get().games, "mate"] });
    }
    await context.globalState.update("session.addedMate", true);
  }

  const credits = new Credits(() => prefs.get().wallet);
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
  let sawSnakeId: string | null = null;
  let rewardedMatch: string | null = null;
  bridge.onChange((state) => {
    const id = state.match?.matchId ?? null;
    if (id && id !== sawMatchId && state.match?.status !== "finished") {
      sawMatchId = id;
      if (prefs.get().games.includes("chess")) openBoard("chess");
      vscode.window.setStatusBarMessage(`Session: match ${id} started`, 4000);
    }
    if (!id) sawMatchId = null;
    const snakeId = state.snake?.matchId ?? null;
    const inSnake = state.snake?.players.some(
      (player) => player.id === state.me?.id && player.connected,
    );
    if (
      snakeId &&
      state.snake?.status !== "finished" &&
      inSnake &&
      prefs.get().games.includes("snakes") &&
      snakeId !== sawSnakeId
    ) {
      sawSnakeId = snakeId;
      openBoard("snakes");
    }
    if (!inSnake) sawSnakeId = null;
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
      if (!raw.game || !(GAME_IDS as readonly string[]).includes(raw.game)) return;
      lastTrigger = raw.at;
      const picked = prefs.get();
      if (!picked.onboarded) return;
      const game = raw.game as GameId;
      const panel = BoardPanel.show(bridge, prefs, credits);
      if (game === "chess" && picked.multiplayer) {
        const match = bridge.state.match;
        if (!match || match.status === "finished") bridge.next();
      }
      if (game === "snakes") {
        const room = raw.room?.trim() || "OPEN";
        bridge.snakeJoin(room);
        vscode.window.setStatusBarMessage(`Session: snakes · room ${room.toUpperCase()}`, 4000);
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
