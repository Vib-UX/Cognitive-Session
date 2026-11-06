import * as vscode from "vscode";
import type { GameId, PrefsStore } from "./prefs";
import { GAME_IDS } from "./prefs";
import type { RelayBridge } from "./relayBridge";
import type { UiState } from "./types";

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "session.sidebar";
  private view?: vscode.WebviewView;
  private unsub?: () => void;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly bridge: RelayBridge,
    private readonly prefs: PrefsStore,
    private readonly openBoard: (game?: GameId) => void,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    webviewView.webview.html = this.html(webviewView.webview);

    this.unsub?.();
    this.unsub = this.bridge.onChange((state) => this.postState(state));

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case "connect":
          try {
            await this.bridge.connect();
          } catch (err) {
            vscode.window.showErrorMessage(
              `Session relay: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          break;
        case "createRoom":
          this.bridge.createRoom();
          break;
        case "joinRoom":
          this.bridge.joinRoom(String(msg.code ?? ""));
          break;
        case "leaveRoom":
          this.bridge.leaveRoom();
          break;
        case "ping":
          if (msg.to) this.bridge.ping(msg.to, String(msg.text ?? "hello"));
          break;
        case "challenge":
          if (msg.to) this.bridge.challenge(msg.to, String(msg.stakeWei ?? "0"));
          break;
        case "respond":
          this.bridge.respond(String(msg.challengeId), Boolean(msg.accept));
          break;
        case "openBoard":
          this.openBoard();
          break;
        case "refresh":
          this.bridge.poll();
          break;
        case "next": {
          const picked = this.prefs.get();
          if (picked.multiplayer && picked.games.includes("chess")) {
            this.bridge.next();
            this.openBoard("chess");
          } else {
            this.openBoard(picked.games[0]);
          }
          break;
        }
        case "ready":
          this.postPrefs();
          break;
        case "savePrefs": {
          const games = Array.isArray(msg.games)
            ? msg.games.filter((game: string): game is GameId =>
                (GAME_IDS as readonly string[]).includes(game),
              )
            : [];
          const saved = await this.prefs.update({
            games,
            multiplayer: Boolean(msg.multiplayer),
          });
          this.postPrefs();
          this.openBoard(saved.games[0]);
          break;
        }
      }
    });

    webviewView.onDidDispose(() => {
      this.unsub?.();
      this.unsub = undefined;
      this.view = undefined;
    });
  }

  refresh() {
    if (this.view) this.postState(this.bridge.state);
  }

  private postState(state: UiState) {
    this.view?.webview.postMessage({ type: "state", state });
  }

  private postPrefs() {
    this.view?.webview.postMessage({ type: "prefs", prefs: this.prefs.get() });
  }

  private html(webview: vscode.Webview): string {
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src ${webview.cspSource} 'unsafe-inline'`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    :root {
      color-scheme: light dark;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
    }
    body { margin: 0; padding: 10px; }
    h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.7; margin: 14px 0 6px; }
    .status { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #888; }
    .dot.on { background: #3fb950; box-shadow: 0 0 0 3px rgba(63,185,80,0.2); }
    .mono { font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; opacity: 0.8; }
    .me { font-size: 12px; line-height: 1.35; margin: 2px 0 4px; }
    .me .you {
      display: inline-block;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      margin-right: 6px;
      padding: 1px 6px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--vscode-button-background) 45%, transparent);
    }
    .card {
      border: 1px solid var(--vscode-widget-border, #444);
      border-radius: 8px;
      padding: 8px;
      margin-bottom: 6px;
      background: var(--vscode-editor-background);
    }
    .row { display: flex; justify-content: space-between; gap: 6px; align-items: center; }
    button, input {
      font: inherit;
      border-radius: 6px;
      border: 1px solid var(--vscode-button-border, transparent);
      padding: 5px 8px;
    }
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      cursor: pointer;
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button.next {
      width: 100%;
      margin-top: 8px;
      font-weight: 600;
    }
    details { margin-top: 12px; }
    details summary { cursor: pointer; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.7; }
    input {
      width: 100%;
      box-sizing: border-box;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-color: var(--vscode-input-border, #555);
      margin: 4px 0 8px;
    }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .err { color: var(--vscode-errorForeground); font-size: 12px; }
    .empty { opacity: 0.6; font-size: 12px; }
    .badge {
      font-size: 10px; padding: 1px 6px; border-radius: 999px;
      background: color-mix(in srgb, var(--vscode-button-background) 30%, transparent);
    }
    .choice { display: flex; align-items: center; gap: 8px; margin: 6px 0; cursor: pointer; }
    .choice input { width: auto; margin: 0; }
  </style>
</head>
<body>
  <div class="status">
    <span class="dot" id="dot"></span>
    <span id="statusText">Disconnected</span>
  </div>
  <div id="me" class="me"></div>
  <div id="err" class="err"></div>
  <div class="card" id="gamesCard">
    <h2 style="margin-top:0">Play</h2>
    <div class="empty" id="onboardLead">Pick what you want while you code.</div>
    <label class="choice"><input type="checkbox" data-game="chess" checked /> Chess</label>
    <label class="choice"><input type="checkbox" data-game="sudoku" /> Sudoku</label>
    <label class="choice"><input type="checkbox" data-game="maths" /> Maths</label>
    <label class="choice"><input type="checkbox" id="multiplayer" checked /> Multiplayer</label>
    <div class="empty" id="gamesHint">Multiplayer pairs a chess game with whoever is waiting. Sudoku and maths are solo puzzles.</div>
    <button id="savePrefs">Continue</button>
  </div>
  <div id="app" style="display:none">
  <button class="next" id="next">Next</button>
  <div class="empty" id="nextHint" style="margin-top:6px">Pairs you with whoever is already waiting. No room.</div>

  <div class="actions">
    <button class="secondary" id="connect">Connect</button>
    <button class="secondary" id="refresh">Refresh</button>
    <button class="secondary" id="openBoard">Open board</button>
  </div>

  <h2>Lobby</h2>
  <div class="empty" style="margin-bottom:6px">Hit Next. If someone is waiting, the board opens with them. If not, you wait for the next person.</div>
  <div id="peers"></div>

  <h2>Challenges</h2>
  <div id="challenges"></div>

  <h2>Pings</h2>
  <div id="pings"></div>

  <details>
    <summary>Room (optional)</summary>
    <div id="room" class="card empty">Not in a room</div>
    <input id="roomCode" placeholder="Room code (e.g. AB12)" />
    <div class="actions">
      <button id="createRoom">Create room</button>
      <button class="secondary" id="joinRoom">Join</button>
      <button class="secondary" id="leaveRoom">Leave</button>
    </div>
  </details>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const $ = (id) => document.getElementById(id);

    $('connect').onclick = () => vscode.postMessage({ type: 'connect' });
    $('refresh').onclick = () => vscode.postMessage({ type: 'refresh' });
    $('openBoard').onclick = () => vscode.postMessage({ type: 'openBoard' });
    $('createRoom').onclick = () => vscode.postMessage({ type: 'createRoom' });
    $('joinRoom').onclick = () => vscode.postMessage({ type: 'joinRoom', code: $('roomCode').value });
    $('leaveRoom').onclick = () => vscode.postMessage({ type: 'leaveRoom' });
    $('next').onclick = () => vscode.postMessage({ type: 'next' });
    $('savePrefs').onclick = () => {
      const games = Array.from(document.querySelectorAll('[data-game]:checked')).map((el) => el.getAttribute('data-game'));
      vscode.postMessage({ type: 'savePrefs', games, multiplayer: $('multiplayer').checked });
    };
    $('multiplayer').onchange = () => {
      if ($('multiplayer').checked) document.querySelector('[data-game="chess"]').checked = true;
    };

    let prefs = { onboarded: false, games: ['chess'], multiplayer: true };
    function chessMulti() {
      return prefs.multiplayer && prefs.games.indexOf('chess') !== -1;
    }
    function applyPrefs(next) {
      prefs = next;
      document.querySelectorAll('[data-game]').forEach((el) => {
        el.checked = prefs.games.indexOf(el.getAttribute('data-game')) !== -1;
      });
      $('multiplayer').checked = !!prefs.multiplayer;
      $('app').style.display = prefs.onboarded ? '' : 'none';
      $('savePrefs').textContent = prefs.onboarded ? 'Save' : 'Continue';
      $('onboardLead').textContent = prefs.onboarded
        ? 'Change games anytime. Sudoku and maths open on the board.'
        : 'Pick what you want while you code.';
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'prefs') {
        applyPrefs(msg.prefs);
        return;
      }
      if (msg.type !== 'state') return;
      const s = msg.state;
      $('dot').className = 'dot' + (s.connected ? ' on' : '');
      $('statusText').textContent = !s.connected
        ? 'Disconnected'
        : s.seeking
          ? 'Waiting for the next person'
          : (s.waiting > 0 ? 'Connected · ' + s.waiting + ' waiting' : 'Connected to relay');
      if (!chessMulti()) {
        $('next').textContent = 'Play';
        $('nextHint').textContent = 'Opens the puzzles you picked. Turn on multiplayer to pair a chess game.';
      } else {
        $('next').textContent = s.seeking ? 'Waiting…' : 'Next';
        $('nextHint').textContent = s.seeking
          ? 'You are in the queue. The next person who hits Next joins you.'
          : (s.waiting > 0
            ? 'Someone is waiting. Next opens a game with them.'
            : 'Pairs you with whoever is already waiting. No room.');
      }
      $('me').innerHTML = s.me
        ? '<span class="you">You</span>' + (s.me.ensName || s.me.displayName) +
          '<div class="mono">' + s.me.id + '</div>'
        : '';
      $('err').textContent = s.error || '';

      if (s.room) {
        $('room').className = 'card';
        $('room').innerHTML = '<div class="row"><strong class="mono">' + s.room.code + '</strong><span class="badge">' +
          s.room.members.length + ' members</span></div>' +
          (s.room.matchId ? '<div class="mono">match ' + s.room.matchId + '</div>' : '');
      } else {
        $('room').className = 'card empty';
        $('room').textContent = 'Not in a room';
      }

      const peers = $('peers');
      peers.innerHTML = '';
      if (!s.peers.length) {
        peers.innerHTML = '<div class="empty">No other sessions online</div>';
      }
      for (const p of s.peers) {
        const el = document.createElement('div');
        el.className = 'card';
        el.innerHTML = '<div class="row"><div><strong>' + (p.ensName || p.displayName) +
          '</strong><div class="mono">' + p.id + '</div></div><span class="badge">' +
          (p.waiting ? 'waiting' : p.host) +
          (p.roomCode ? ' · ' + p.roomCode : '') + '</span></div>';
        const actions = document.createElement('div');
        actions.className = 'actions';
        const pingBtn = document.createElement('button');
        pingBtn.className = 'secondary';
        pingBtn.textContent = 'Ping';
        pingBtn.onclick = () => vscode.postMessage({ type: 'ping', to: p.id, text: 'hello' });
        const chalBtn = document.createElement('button');
        chalBtn.textContent = 'Challenge';
        chalBtn.onclick = () => vscode.postMessage({ type: 'challenge', to: p.id });
        actions.append(pingBtn, chalBtn);
        el.append(actions);
        peers.append(el);
      }

      const ch = $('challenges');
      ch.innerHTML = '';
      if (!s.challenges.length) ch.innerHTML = '<div class="empty">None</div>';
      for (const c of s.challenges) {
        const el = document.createElement('div');
        el.className = 'card';
        el.innerHTML = '<div><strong>' + c.fromName + '</strong> challenged you</div>';
        const actions = document.createElement('div');
        actions.className = 'actions';
        const yes = document.createElement('button');
        yes.textContent = 'Accept';
        yes.onclick = () => {
          vscode.postMessage({ type: 'respond', challengeId: c.id, accept: true });
          vscode.postMessage({ type: 'openBoard' });
        };
        const no = document.createElement('button');
        no.className = 'secondary';
        no.textContent = 'Decline';
        no.onclick = () => vscode.postMessage({ type: 'respond', challengeId: c.id, accept: false });
        actions.append(yes, no);
        el.append(actions);
        ch.append(el);
      }

      const pings = $('pings');
      pings.innerHTML = '';
      const recent = (s.pings || []).slice().reverse().slice(0, 5);
      if (!recent.length) pings.innerHTML = '<div class="empty">None yet</div>';
      for (const p of recent) {
        const el = document.createElement('div');
        el.className = 'card';
        el.textContent = p.fromName + ': ' + p.text;
        pings.append(el);
      }
    });
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}
