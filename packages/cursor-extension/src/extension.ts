import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { BoardPanel } from "./boardPanel";
import type { GameId } from "./prefs";
import { PrefsStore } from "./prefs";
import { RelayBridge } from "./relayBridge";
import { SidebarProvider } from "./sidebarProvider";

let bridge: RelayBridge | undefined;

export async function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration("session");
  const relayUrl = config.get<string>("relayUrl") ?? "ws://127.0.0.1:47831/ws";
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

  const openBoard = (game?: GameId) => {
    if (!bridge) return;
    BoardPanel.show(bridge, prefs, game);
  };

  const sidebar = new SidebarProvider(context.extensionUri, bridge, prefs, openBoard);
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
  bridge.onChange((state) => {
    const id = state.match?.matchId ?? null;
    if (id && id !== sawMatchId && state.match?.status !== "finished") {
      sawMatchId = id;
      if (prefs.get().games.includes("chess")) openBoard("chess");
      vscode.window.setStatusBarMessage(`Session: match ${id} started`, 4000);
    }
    if (!id) sawMatchId = null;
  });

  context.subscriptions.push({
    dispose: () => bridge?.disconnect(),
  });
}

export function deactivate() {
  bridge?.disconnect();
  bridge = undefined;
}
