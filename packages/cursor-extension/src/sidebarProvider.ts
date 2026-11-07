import * as vscode from "vscode";
import type { Credits } from "./credits";
import type { GameId, PrefsStore } from "./prefs";
import { EVM_CHAINS, GAME_IDS, isEvmAddress } from "./prefs";
import type { RelayBridge } from "./relayBridge";
import type { BankView, UiState } from "./types";

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "session.sidebar";
  private view?: vscode.WebviewView;
  private unsub?: () => void;
  private unsubCredits?: () => void;
  private unsubBank?: () => void;

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
    this.unsubBank?.();
    this.unsubBank = this.bridge.onBank((view) => this.postBank(view));

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
        case "playFlappy":
          this.bridge.flappyJoin();
          this.openBoard("flappy");
          break;
        case "refresh":
          this.bridge.poll();
          break;
        case "rematch":
          if (msg.game === "chess" || msg.game === "flappy") this.bridge.askRematch(msg.game);
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
          this.postBank(this.bridge.bank);
          break;
        case "claimBalance": {
          const prefs = this.prefs.get();
          if (!isEvmAddress(prefs.wallet) || !prefs.chainId) {
            vscode.window.showWarningMessage("Session: set a wallet and a mainnet chain to receive USDC.");
            break;
          }
          this.bridge.setPlayer(prefs.wallet as `0x${string}`, prefs.chainId);
          this.bridge.claimBalance({
            onPaid: (usd, chainName) => {
              vscode.window.showInformationMessage(`Session: ${usd} USDC sent on ${chainName}.`);
            },
            onError: (message) => {
              vscode.window.showErrorMessage(`Session: ${message}`);
            },
          });
          break;
        }
        case "syncDeposit": {
          const prefs = this.prefs.get();
          if (!isEvmAddress(prefs.wallet)) {
            vscode.window.showWarningMessage("Session: set a wallet before checking the deposit.");
            break;
          }
          this.bridge.setPlayer(prefs.wallet as `0x${string}`, prefs.chainId);
          if (!this.bridge.syncDeposit()) {
            vscode.window.showWarningMessage("Session: connect to the relay, then check the deposit.");
          }
          break;
        }
        case "openLink": {
          const href = String(msg.href ?? "");
          if (href.startsWith("https://ccip.chain.link/")) {
            await vscode.env.openExternal(vscode.Uri.parse(href));
          }
          break;
        }
        case "copyDeposit": {
          const address = this.bridge.bank?.address || "0xE2ca5C8ed8589Dc61abE1B2c2Dae309d2f86410c";
          await vscode.env.clipboard.writeText(address);
          vscode.window.showInformationMessage("Session: deposit address copied.");
          break;
        }
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
          this.bridge.syncDeposit();
          this.postPrefs();
          break;
        }
      }
    });

    webviewView.onDidDispose(() => {
      this.unsub?.();
      this.unsubCredits?.();
      this.unsubBank?.();
      this.unsub = undefined;
      this.unsubCredits = undefined;
      this.unsubBank = undefined;
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

  private postBank(view: BankView | null) {
    this.view?.webview.postMessage({ type: "bank", bank: view });
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
    body { margin: 0; padding: 14px 12px 20px; }
    h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.65; margin: 16px 0 8px; }
    .status { display: flex; align-items: center; gap: 8px; font-size: 12px; opacity: 0.85; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #888; flex: none; }
    .dot.on { background: #3fb950; box-shadow: 0 0 0 3px rgba(63,185,80,0.18); }
    .mono { font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; opacity: 0.75; }
    .me { font-size: 13px; font-weight: 600; margin: 8px 0 14px; }
    .card {
      border: 1px solid var(--vscode-widget-border, #444);
      border-radius: 10px;
      padding: 12px;
      margin-bottom: 10px;
      background: var(--vscode-editor-background);
    }
    .row { display: flex; justify-content: space-between; gap: 8px; align-items: center; margin: 6px 0; }
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
      padding: 8px 10px;
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
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .stack { display: grid; gap: 8px; margin-top: 12px; }
    .stack button.next { margin-top: 0; }
    label.field { display: block; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; opacity: 0.65; margin-top: 4px; }
    .err { color: var(--vscode-errorForeground); font-size: 12px; }
    .empty { opacity: 0.6; font-size: 12px; }
    .badge {
      font-size: 10px; padding: 1px 6px; border-radius: 999px;
      background: color-mix(in srgb, var(--vscode-button-background) 30%, transparent);
    }
    .games { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 10px; margin-bottom: 8px; }
    .choice { display: flex; align-items: center; gap: 8px; margin: 4px 0; cursor: pointer; }
    .choice.wide { grid-column: 1 / -1; }
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
    .addr { word-break: break-all; font-size: 12px; line-height: 1.4; margin: 6px 0; user-select: text; }
    #bankTransfer a { word-break: break-all; color: var(--vscode-textLink-foreground); }
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
    <div class="games">
      <label class="choice"><input type="checkbox" data-game="chess" checked /> Chess</label>
      <label class="choice"><input type="checkbox" data-game="flappy" checked /> Flappy</label>
      <label class="choice"><input type="checkbox" data-game="sudoku" /> Sudoku</label>
      <label class="choice"><input type="checkbox" data-game="maths" /> Maths</label>
      <label class="choice"><input type="checkbox" data-game="mate" /> Mate in 1</label>
      <label class="choice wide"><input type="checkbox" id="multiplayer" checked /> Multiplayer</label>
    </div>
    <label class="field" for="wallet">Wallet</label>
    <input id="wallet" placeholder="0x…" spellcheck="false" />
    <label class="field" for="chain">Chain</label>
    <select id="chain">
      <option value="8453">Base</option>
      <option value="1">Ethereum</option>
      <option value="42161">Arbitrum</option>
      <option value="10">Optimism</option>
      <option value="137">Polygon</option>
    </select>
    <p class="empty" id="depositHint">Send $1.00 USDC on the chain you pick, to that chain's treasury. After it lands, the $0.05 bet is sent to you.</p>
    <div class="mono addr" id="setupAddress">0xE2ca5C8ed8589Dc61abE1B2c2Dae309d2f86410c</div>
    <div class="err" id="walletErr"></div>
    <button class="next" id="savePrefs" style="margin-top:0">Continue</button>
  </div>
  <div id="app" style="display:none">
  <div class="card" id="bankCard">
    <h2 style="margin-top:0">Balance</h2>
    <div class="row"><span>Deposit</span><span class="mono" id="bankDeposit">$1.00</span></div>
    <p class="empty" id="bankHint">Send $1.00 USDC on the chain you pick, to that chain's treasury. After it lands, the $0.05 bet is sent to you.</p>
    <div class="mono addr" id="bankAddress">0xE2ca5C8ed8589Dc61abE1B2c2Dae309d2f86410c</div>
    <div class="actions">
      <button class="secondary" id="copyDeposit">Copy address</button>
      <button class="secondary" id="checkDeposit">Check deposit</button>
    </div>
    <div class="row"><span>Your balance</span><span class="mono" id="bankBalance">$0.00</span></div>
    <div id="bankTransfer" style="display:none; margin-top:6px"></div>
    <div class="empty" id="bankNote" style="display:none"></div>
    <button class="next" id="claimBalance" disabled>Claim</button>
  </div>
  <div class="card" id="creditsCard">
    <h2 style="margin-top:0">Credits</h2>
    <div class="row"><span>Today</span><span class="mono" id="creditToday">$0.00</span></div>
    <div class="row"><span>Pending</span><span class="mono" id="creditPending">$0.00</span></div>
    <div class="row"><span>Claimable</span><span class="mono" id="creditReady">$0.00</span></div>
    <div class="empty" id="creditNote" style="display:none"></div>
    <button class="next" id="claim" disabled>Claim</button>
    <div class="ledger" id="ledger"></div>
  </div>
  <div class="stack">
    <button class="next" id="playFlappy">Play flappy</button>
    <button class="next" id="next">Play</button>
    <button class="next" id="rematch" style="display:none">Rematch</button>
  </div>

  <div class="actions">
    <button class="secondary" id="connect">Connect</button>
    <button class="secondary" id="refresh">Refresh</button>
    <button class="secondary" id="openBoard">Open board</button>
  </div>

  <h2>Session</h2>
  <div id="peers"></div>

  <div id="challengeBlock" style="display:none">
    <h2>Challenges</h2>
    <div id="challenges"></div>
  </div>

  <div id="pingBlock" style="display:none">
    <h2>Pings</h2>
    <div id="pings"></div>
  </div>

  <details>
    <summary>Room</summary>
    <div id="room" class="card" style="display:none"></div>
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
    $('playFlappy').onclick = () => vscode.postMessage({ type: 'playFlappy' });
    $('createRoom').onclick = () => vscode.postMessage({ type: 'createRoom' });
    $('joinRoom').onclick = () => vscode.postMessage({ type: 'joinRoom', code: $('roomCode').value });
    $('leaveRoom').onclick = () => vscode.postMessage({ type: 'leaveRoom' });
    $('next').onclick = () => vscode.postMessage({ type: 'next' });
    $('rematch').onclick = () => {
      const game = rematchOffer && rematchOffer.game ? rematchOffer.game : lastGame;
      vscode.postMessage({ type: 'rematch', game });
    };
    $('claim').onclick = () => vscode.postMessage({ type: 'claim' });
    $('claimBalance').onclick = () => vscode.postMessage({ type: 'claimBalance' });
    $('checkDeposit').onclick = () => vscode.postMessage({ type: 'syncDeposit' });
    $('copyDeposit').onclick = () => vscode.postMessage({ type: 'copyDeposit' });
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
    const treasuries = {
      8453: '0xE2ca5C8ed8589Dc61abE1B2c2Dae309d2f86410c',
      10: '0x2aa139d40b57560EE8bAa94325cfdc5a7721DE3f',
      1: ''
    };
    function paintDeposit() {
      const chainOption = $('chain').options[$('chain').selectedIndex];
      const chainName = chainOption ? chainOption.textContent : 'your chain';
      const addr = treasuries[$('chain').value] || '';
      const text = addr
        ? 'Send $1.00 USDC on ' + chainName + ' to this treasury. After it lands, the $0.05 bet is sent to you.'
        : chainName + ' has no treasury yet. Deposit USDC on Base or Optimism. The bet is sent to you over CCIP.';
      $('depositHint').textContent = text;
      $('bankHint').textContent = text;
      if (addr) {
        $('setupAddress').textContent = addr;
        $('bankAddress').textContent = addr;
      }
    }
    $('chain').onchange = paintDeposit;

    let prefs = { onboarded: false, games: ['chess'], multiplayer: true };
    let rematchOffer = null;
    let lastGame = 'chess';
    function chessMulti() {
      return prefs.multiplayer && prefs.games.indexOf('chess') !== -1;
    }
    function renderLedger(rows) {
      const box = $('ledger');
      box.textContent = '';
      if (!rows.length) return;
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

    function applyBank(bank) {
      const view = bank || {};
      $('bankDeposit').textContent = view.depositUsd || '$1.00';
      $('bankBalance').textContent = view.balanceUsd || '$0.00';
      if (view.depositChain) {
        const text = view.address
          ? 'Send $1.00 USDC on ' + view.depositChain + ' to this treasury. After it lands, the $0.05 bet is sent to you.'
          : view.depositChain + ' has no treasury yet. Deposit USDC on Base or Optimism. The bet is sent to you over CCIP.';
        $('bankHint').textContent = text;
        $('depositHint').textContent = text;
      }
      if (view.address) {
        $('bankAddress').textContent = view.address;
        $('setupAddress').textContent = view.address;
      }
      const line = view.transfer && view.transfer.line;
      const box = $('bankTransfer');
      box.textContent = '';
      box.style.display = line ? '' : 'none';
      if (line) {
        const raw = String(line);
        const at = raw.indexOf('https://ccip.chain.link/');
        const url = (view.transfer && view.transfer.href) || (at >= 0 ? raw.slice(at).split(' ')[0] : '');
        const text = at >= 0 ? raw.slice(0, at).trim() : raw;
        if (text) box.appendChild(document.createTextNode(text));
        if (url) {
          if (text) box.appendChild(document.createElement('br'));
          const link = document.createElement('a');
          link.href = url;
          link.textContent = url;
          link.addEventListener('click', (event) => {
            event.preventDefault();
            vscode.postMessage({ type: 'openLink', href: url });
          });
          box.appendChild(link);
        }
      }
      const note = view.note || '';
      $('bankNote').style.display = note ? '' : 'none';
      $('bankNote').textContent = note;
      $('claimBalance').disabled = !view.canClaim;
      $('claimBalance').textContent = view.claimLabel || 'Claim';
      const funded = !!view.canPlay;
      $('playFlappy').disabled = !funded;
      $('next').disabled = !funded;
      if (!funded) {
        $('playFlappy').textContent = 'Deposit $1.00 to play';
        $('next').textContent = 'Deposit $1.00 to play';
      } else {
        $('playFlappy').textContent = 'Play flappy';
        if ($('next').textContent === 'Deposit $1.00 to play') $('next').textContent = 'Play';
      }
    }

    function applyPrefs(next) {
      prefs = next;
      document.querySelectorAll('[data-game]').forEach((el) => {
        el.checked = prefs.games.indexOf(el.getAttribute('data-game')) !== -1;
      });
      $('multiplayer').checked = !!prefs.multiplayer;
      if (document.activeElement !== $('wallet')) $('wallet').value = prefs.wallet || '';
      if (prefs.chainId) $('chain').value = String(prefs.chainId);
      paintDeposit();
      $('app').style.display = prefs.onboarded ? '' : 'none';
      $('savePrefs').textContent = prefs.onboarded ? 'Save' : 'Continue';
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
        const note = c.note || '';
        const quiet = !note || note.indexOf('ready to claim') !== -1 || note.indexOf('Solves pay') !== -1 || note.indexOf('USDC pays') !== -1;
        $('creditNote').style.display = quiet ? 'none' : '';
        $('creditNote').textContent = quiet ? '' : note;
        $('claim').disabled = !c.canClaim;
        $('claim').textContent = c.claimLabel || 'Claim';
        renderLedger(Array.isArray(c.ledger) ? c.ledger : []);
        return;
      }
      if (msg.type === 'bank') {
        applyBank(msg.bank);
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
          ? 'Drawing'
          : s.seeking
            ? 'Waiting'
            : (s.waiting > 0 ? 'Connected · ' + s.waiting : 'Connected');
      const chessOver = s.match && s.match.status === 'finished' && !s.seeking && !s.drawing;
      const flapOver = s.flappy && s.flappy.status === 'done' && !s.flappy.seeking;
      rematchOffer = s.rematch || null;
      lastGame = s.lastGame || (flapOver && !chessOver ? 'flappy' : 'chess');
      const showRematch = chessOver || flapOver;
      $('rematch').style.display = showRematch ? '' : 'none';
      $('rematch').textContent = s.rematch && s.rematch.waiting
        ? 'Waiting for rematch…'
        : (s.rematch ? 'Accept rematch' : 'Rematch');
      $('next').textContent = !chessMulti()
        ? 'Play'
        : s.drawing
          ? 'Drawing…'
          : s.seeking
            ? 'Waiting…'
            : 'Next';
      $('me').textContent = s.me ? (s.me.ensName || s.me.displayName) : '';
      $('err').textContent = s.error || '';

      if (s.room) {
        $('room').style.display = '';
        $('room').className = 'card';
        $('room').innerHTML = '<div class="row"><strong class="mono">' + s.room.code + '</strong><span class="badge">' +
          s.room.members.length + '</span></div>';
      } else {
        $('room').style.display = 'none';
        $('room').textContent = '';
      }

      const peers = $('peers');
      peers.innerHTML = '';
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
      $('challengeBlock').style.display = s.challenges.length ? '' : 'none';
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
      $('pingBlock').style.display = recent.length ? '' : 'none';
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
