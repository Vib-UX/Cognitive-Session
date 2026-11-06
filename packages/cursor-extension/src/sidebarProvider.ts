import * as vscode from "vscode";
import type { Credits } from "./credits";
import type { GameId, PrefsStore } from "./prefs";
import { EVM_CHAINS, GAME_IDS, isEvmAddress } from "./prefs";
import type { RelayBridge } from "./relayBridge";
import type { UiState } from "./types";

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "session.sidebar";
  private view?: vscode.WebviewView;
  private unsub?: () => void;
  private unsubCredits?: () => void;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly bridge: RelayBridge,
    private readonly prefs: PrefsStore,
    private readonly credits: Credits,
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
    this.unsub = this.bridge.onChange((state, kind) => {
      if (kind === "snake") return;
      this.postState(state);
    });
    this.unsubCredits?.();
    this.unsubCredits = this.credits.onChange(() => this.postCredits());

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
        case "playSnakes":
          this.bridge.snakeJoin(typeof msg.code === "string" && msg.code.trim() ? msg.code : "OPEN");
          this.openBoard("snakes");
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
          this.postCredits();
          break;
        case "claim": {
          const prefs = this.prefs.get();
          if (!isEvmAddress(prefs.wallet) || !prefs.chainId) {
            vscode.window.showWarningMessage("Session: set a wallet and a mainnet chain to receive USDC.");
            break;
          }
          const claimed = this.credits.claim();
          this.postCredits();
          if (claimed.cents <= 0) break;
          const amount = (BigInt(claimed.cents) * 10_000n).toString();
          this.bridge.setPlayer(prefs.wallet as `0x${string}`, prefs.chainId);
          this.bridge.claimReward(amount, {
            onReward: (txHash, chainName) => {
              this.credits.markSent(claimed.cents, prefs.wallet, chainName, txHash);
              this.postCredits();
              vscode.window.showInformationMessage(`Session: ${claimed.cents / 100} USDC sent on ${chainName}.`);
            },
            onError: (message) => {
              this.credits.restore(claimed.cents, message);
              this.postCredits();
              vscode.window.showErrorMessage(`Session: ${message}`);
            },
          });
          break;
        }
        case "savePrefs": {
          const games = Array.isArray(msg.games)
            ? msg.games.filter((game: string): game is GameId =>
                (GAME_IDS as readonly string[]).includes(game),
              )
            : [];
          const wallet = String(msg.wallet ?? "").trim();
          const chain = EVM_CHAINS.find((item) => item.id === Number(msg.chainId));
          if (!isEvmAddress(wallet) || !chain) {
            this.view?.webview.postMessage({
              type: "prefsError",
              message: "Enter a 0x wallet address and an EVM chain.",
            });
            break;
          }
          await this.prefs.update({
            games,
            multiplayer: Boolean(msg.multiplayer),
            wallet,
            chainId: chain.id,
          });
          this.bridge.setPlayer(wallet as `0x${string}`, chain.id);
          this.postPrefs();
          break;
        }
      }
    });

    webviewView.onDidDispose(() => {
      this.unsub?.();
      this.unsubCredits?.();
      this.unsub = undefined;
      this.unsubCredits = undefined;
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

  private postCredits() {
    this.view?.webview.postMessage({ type: "credits", credits: this.credits.view() });
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
    select, button, input {
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
    select, input {
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
    .ledger { margin-top: 8px; }
    .ledger a {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: center;
      color: inherit;
      text-decoration: none;
      padding: 5px 0;
      border-top: 1px solid var(--vscode-widget-border, #444);
    }
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
    <label class="choice"><input type="checkbox" data-game="snakes" checked /> Snakes</label>
    <label class="choice"><input type="checkbox" data-game="sudoku" /> Sudoku</label>
    <label class="choice"><input type="checkbox" data-game="maths" /> Maths</label>
    <label class="choice"><input type="checkbox" data-game="mate" /> Mate in 1</label>
    <label class="choice"><input type="checkbox" id="multiplayer" checked /> Multiplayer</label>
    <label class="empty" for="wallet">Wallet</label>
    <input id="wallet" placeholder="0x…" spellcheck="false" />
    <label class="empty" for="chain">Chain</label>
    <select id="chain">
      <option value="84532">Base Sepolia</option>
      <option value="11155111">Ethereum Sepolia</option>
      <option value="1">Ethereum</option>
      <option value="8453">Base</option>
      <option value="42161">Arbitrum</option>
      <option value="10">Optimism</option>
      <option value="137">Polygon</option>
    </select>
    <div class="err" id="walletErr"></div>
    <div class="empty" id="gamesHint">Prompt the agent to open the next puzzle. Snakes joins the shared arena. Multiplayer chess pairs with whoever is waiting.</div>
    <div class="mono" id="walletLine"></div>
    <button id="savePrefs">Continue</button>
  </div>
  <div id="app" style="display:none">
  <div class="card" id="creditsCard">
    <h2 style="margin-top:0">Credits</h2>
    <div class="row"><span>Today</span><span class="mono" id="creditToday">$0.00</span></div>
    <div class="row"><span>While the agent works</span><span class="mono" id="creditPending">$0.00</span></div>
    <div class="row"><span>Ready to claim</span><span class="mono" id="creditReady">$0.00</span></div>
    <div class="empty" id="creditNote">USDC pays on Ethereum, Base, Arbitrum, Optimism, or Polygon.</div>
    <button class="next" id="claim" disabled>Claim</button>
    <div class="ledger" id="ledger"></div>
  </div>
  <button class="next" id="playSnakes">Play snakes</button>
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
    $('playSnakes').onclick = () => vscode.postMessage({ type: 'playSnakes' });
    $('createRoom').onclick = () => vscode.postMessage({ type: 'createRoom' });
    $('joinRoom').onclick = () => vscode.postMessage({ type: 'joinRoom', code: $('roomCode').value });
    $('leaveRoom').onclick = () => vscode.postMessage({ type: 'leaveRoom' });
    $('next').onclick = () => vscode.postMessage({ type: 'next' });
    $('claim').onclick = () => vscode.postMessage({ type: 'claim' });
    $('savePrefs').onclick = () => {
      const games = Array.from(document.querySelectorAll('[data-game]:checked')).map((el) => el.getAttribute('data-game'));
      const wallet = $('wallet').value.trim();
      $('walletErr').textContent = /^0x[a-fA-F0-9]{40}$/.test(wallet)
        ? ''
        : 'Enter an EVM address: 0x and 40 hex characters.';
      if ($('walletErr').textContent) return;
      vscode.postMessage({
        type: 'savePrefs',
        games,
        multiplayer: $('multiplayer').checked,
        wallet,
        chainId: Number($('chain').value),
      });
    };
    $('multiplayer').onchange = () => {
      if ($('multiplayer').checked) document.querySelector('[data-game="chess"]').checked = true;
    };

    let prefs = { onboarded: false, games: ['chess'], multiplayer: true };
    function chessMulti() {
      return prefs.multiplayer && prefs.games.indexOf('chess') !== -1;
    }
    function renderLedger(rows) {
      const box = $('ledger');
      box.textContent = '';
      if (!rows.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'Claims show up here with the chain and the Base transaction.';
        box.appendChild(empty);
        return;
      }
      rows.forEach((row) => {
        const link = document.createElement('a');
        link.href = typeof row.href === 'string' ? row.href : '#';
        const amount = document.createElement('span');
        amount.textContent = (row.usd || '') + ' · ' + (row.chainName || '');
        const tx = document.createElement('span');
        tx.className = 'mono';
        tx.textContent = row.tx || '';
        link.appendChild(amount);
        link.appendChild(tx);
        box.appendChild(link);
      });
    }

    function applyPrefs(next) {
      prefs = next;
      document.querySelectorAll('[data-game]').forEach((el) => {
        el.checked = prefs.games.indexOf(el.getAttribute('data-game')) !== -1;
      });
      $('multiplayer').checked = !!prefs.multiplayer;
      if (document.activeElement !== $('wallet')) $('wallet').value = prefs.wallet || '';
      if (prefs.chainId) $('chain').value = String(prefs.chainId);
      $('app').style.display = prefs.onboarded ? '' : 'none';
      $('savePrefs').textContent = prefs.onboarded ? 'Save' : 'Continue';
      $('onboardLead').textContent = prefs.onboarded
        ? 'Prompt the agent to start the next puzzle. You can change these anytime.'
        : 'Pick your games, then add the EVM wallet that plays them.';
      const chains = { 84532: 'Base Sepolia', 11155111: 'Ethereum Sepolia', 1: 'Ethereum', 8453: 'Base', 42161: 'Arbitrum', 10: 'Optimism', 137: 'Polygon' };
      $('walletLine').textContent = prefs.wallet
        ? prefs.wallet.slice(0, 6) + '…' + prefs.wallet.slice(-4) + ' · ' + (chains[prefs.chainId] || 'EVM')
        : '';
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'prefs') {
        applyPrefs(msg.prefs);
        $('walletErr').textContent = '';
        return;
      }
      if (msg.type === 'credits') {
        const c = msg.credits || {};
        $('creditToday').textContent = c.today || '$0.00';
        $('creditPending').textContent = c.pending || '$0.00';
        $('creditReady').textContent = c.claimable || '$0.00';
        $('creditNote').textContent = c.note || $('creditNote').textContent;
        $('claim').disabled = !c.canClaim;
        $('claim').textContent = c.claimLabel || 'Claim';
        renderLedger(Array.isArray(c.ledger) ? c.ledger : []);
        return;
      }
      if (msg.type === 'prefsError') {
        $('walletErr').textContent = msg.message || 'Check the wallet and chain.';
        return;
      }
      if (msg.type !== 'state') return;
      const s = msg.state;
      $('dot').className = 'dot' + (s.connected ? ' on' : '');
      $('statusText').textContent = !s.connected
        ? 'Disconnected'
        : s.drawing
          ? 'Drawing the opening on Base'
          : s.seeking
            ? 'Waiting for the next person'
            : (s.waiting > 0 ? 'Connected · ' + s.waiting + ' waiting' : 'Connected to relay');
      if (!chessMulti()) {
        $('next').textContent = 'Play';
        $('nextHint').textContent = 'Opens the puzzles you picked. Turn on multiplayer to pair a chess game.';
      } else {
        $('next').textContent = s.drawing ? 'Drawing…' : (s.seeking ? 'Waiting…' : 'Next');
        $('nextHint').textContent = s.drawing
          ? 'Paired. Chainlink VRF on Base is choosing who plays white.'
          : s.seeking
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
