import * as vscode from "vscode";
import type { GameId, PrefsStore, SessionPrefs } from "./prefs";
import type { RelayBridge } from "./relayBridge";
import type { ChessState, UiState } from "./types";

export class BoardPanel {
  public static current: BoardPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private unsub?: () => void;
  private unsubPrefs?: () => void;
  private pendingGame: GameId | null = null;

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly bridge: RelayBridge,
    private readonly prefs: PrefsStore,
  ) {
    this.panel = panel;
    this.panel.webview.options = { enableScripts: true };
    this.panel.webview.html = this.html();

    this.unsub = this.bridge.onChange((state) => this.postState(state));

    this.panel.webview.onDidReceiveMessage((msg) => {
      switch (msg.type) {
        case "move":
          if (msg.matchId && msg.uci) {
            this.bridge.move(String(msg.matchId), String(msg.uci));
          }
          break;
        case "resign":
          if (msg.matchId) this.bridge.resign(String(msg.matchId));
          break;
        case "challenge":
          if (msg.to) this.bridge.challenge(msg.to);
          break;
        case "refresh":
          this.bridge.poll();
          break;
        case "next":
          this.bridge.next();
          break;
        case "ready":
          this.postPrefs(this.prefs.get());
          this.postState(this.bridge.state);
          if (this.pendingGame) {
            this.panel.webview.postMessage({ type: "play", game: this.pendingGame });
          }
          break;
      }
    });

    this.unsubPrefs = this.prefs.onChange((prefs) => this.postPrefs(prefs));

    this.panel.onDidDispose(() => {
      this.unsub?.();
      this.unsubPrefs?.();
      BoardPanel.current = undefined;
    });
  }

  static show(bridge: RelayBridge, prefs: PrefsStore, game?: GameId) {
    if (BoardPanel.current) {
      BoardPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      if (game) BoardPanel.current.play(game);
      return BoardPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      "session.board",
      "Session",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );
    BoardPanel.current = new BoardPanel(panel, bridge, prefs);
    if (game) BoardPanel.current.play(game);
    return BoardPanel.current;
  }

  play(game: GameId) {
    this.pendingGame = game;
    this.panel.webview.postMessage({ type: "play", game });
  }

  private postPrefs(prefs: SessionPrefs) {
    this.panel.webview.postMessage({ type: "prefs", prefs });
  }

  private postState(state: UiState) {
    this.panel.webview.postMessage({ type: "state", state });
  }

  private html(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <style>
    :root {
      color-scheme: light dark;
      --light: #eeeed2;
      --dark: #769656;
      --hl: #f6f669;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
    }
    body { margin: 0; padding: 16px; }
    h1 { font-size: 16px; margin: 0 0 4px; }
    .sub { opacity: 0.7; font-size: 12px; margin-bottom: 12px; }
    .layout { display: flex; flex-wrap: wrap; gap: 20px; align-items: flex-start; }
    .board-col { width: max-content; }
    .playerbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      width: 512px;
      box-sizing: border-box;
      padding: 6px 8px;
      margin: 4px 0;
      border-radius: 6px;
      background: #262421;
      color: #fff;
    }
    .pname {
      font-size: 14px;
      font-weight: 650;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .clock {
      min-width: 84px;
      padding: 6px 10px;
      border-radius: 6px;
      text-align: center;
      font-weight: 750;
      font-variant-numeric: tabular-nums;
      font-size: 20px;
      letter-spacing: 0.02em;
      background: #302e2b;
      color: #fff;
    }
    .clock.run {
      background: #fff;
      color: #1a1a1a;
    }
    .clock.low { background: #c0392b; color: #fff; }
    .board {
      display: grid;
      grid-template-columns: repeat(8, 64px);
      grid-template-rows: repeat(8, 64px);
      width: max-content;
      user-select: none;
      border-radius: 2px;
    }
    .sq {
      width: 64px; height: 64px;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer;
      position: relative;
    }
    .sq .piece { width: 54px; height: 54px; pointer-events: none; margin-bottom: 4px; }
    .coord {
      position: absolute;
      font-size: 12px;
      font-weight: 700;
      line-height: 1;
      pointer-events: none;
    }
    .coord.rank { top: 3px; left: 4px; }
    .coord.file { bottom: 3px; left: 4px; }
    .coord.on-light { color: #769656; }
    .coord.on-dark { color: #eeeed2; }
    .sq.light { background: var(--light); }
    .sq.dark { background: var(--dark); }
    .sq.selected { outline: 3px solid #f6f669; outline-offset: -3px; }
    .sq.legal::after {
      content: '';
      width: 14px; height: 14px; border-radius: 50%;
      background: rgba(0,0,0,0.25);
      position: absolute;
    }
    .meta { min-width: 220px; max-width: 320px; }
    .card {
      border: 1px solid var(--vscode-widget-border, #444);
      border-radius: 10px;
      padding: 10px;
      margin-bottom: 10px;
      background: var(--vscode-editor-background);
    }
    .mono { font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
    button, input {
      font: inherit; border-radius: 6px; padding: 6px 10px;
      border: 1px solid var(--vscode-input-border, #555);
    }
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      cursor: pointer;
      margin-right: 6px; margin-top: 6px;
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    input {
      width: 100%; box-sizing: border-box;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      margin-top: 6px;
    }
    .gamebar { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    .sudo {
      display: grid;
      grid-template-columns: repeat(9, 36px);
      width: max-content;
      background: #262421;
      gap: 1px;
      padding: 2px;
    }
    .sudo input {
      width: 36px; height: 36px; margin: 0; padding: 0;
      text-align: center; font-size: 16px; font-weight: 700;
      border-radius: 0; border: none;
      background: #fff; color: #1a1a1a;
    }
    .sudo input.given { background: #eeeed2; }
    .sudo input.bad { background: #f4c7c3; }
    .sudo input.edge-r { box-shadow: inset -2px 0 0 #262421; }
    .sudo input.edge-b { box-shadow: inset 0 -2px 0 #262421; }
    .math-prompt { font-size: 42px; font-weight: 750; margin: 16px 0; }
  </style>
</head>
<body>
  <svg width="0" height="0" aria-hidden="true">
    <defs>
      <linearGradient id="fill-w" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffffff"/>
        <stop offset="0.55" stop-color="#f3f3f3"/>
        <stop offset="1" stop-color="#d5d5d5"/>
      </linearGradient>
      <linearGradient id="fill-b" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#7a7a7a"/>
        <stop offset="0.4" stop-color="#4a4a4a"/>
        <stop offset="1" stop-color="#2a2a2a"/>
      </linearGradient>
      <filter id="piece-shadow" x="-20%" y="-20%" width="150%" height="150%">
        <feDropShadow dx="0" dy="1.2" stdDeviation="0.7" flood-color="#000" flood-opacity="0.28"/>
      </filter>
    </defs>
  </svg>
  <h1>Session</h1>
  <div class="sub" id="subtitle">Connected. Hit Next to play whoever is waiting.</div>
  <div class="gamebar" id="gameBar"></div>
  <div id="chessWrap">
  <div class="layout">
    <div class="board-col">
      <div class="playerbar" id="topBar" style="display:none"><span class="pname" id="topName">Opponent</span><span class="clock" id="topClock">2:00</span></div>
      <div class="board" id="board"></div>
      <div class="playerbar" id="botBar" style="display:none"><span class="pname" id="botName">You</span><span class="clock" id="botClock">2:00</span></div>
    </div>
    <div class="meta">
      <div class="card" id="info">No active match</div>
      <div class="card">
        <div>Move (click two squares, or type UCI)</div>
        <input id="uci" placeholder="e2e4" />
        <div>
          <button id="play">Play move</button>
          <button id="next">Next</button>
          <button id="resign">Resign</button>
          <button id="refresh">Refresh</button>
        </div>
      </div>
      <div class="card mono" id="me"></div>
    </div>
  </div>
  </div>
  <div id="puzzleWrap" style="display:none">
    <div id="sudokuView" style="display:none">
      <div class="sudo" id="sudoGrid"></div>
      <div class="actions" style="margin-top:8px">
        <button id="sudoNew">New puzzle</button>
      </div>
      <div class="sub" id="sudoNote"></div>
    </div>
    <div id="mathsView" style="display:none">
      <div class="playerbar"><span class="pname" id="mathScore">Score 0</span><span class="clock run" id="mathClock">2:00</span></div>
      <div class="math-prompt" id="mathPrompt">—</div>
      <input id="mathAnswer" placeholder="Answer" />
      <div>
        <button id="mathGo">Answer</button>
        <button id="mathNew" class="secondary">New round</button>
      </div>
      <div class="sub" id="mathNote"></div>
    </div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const SHAPES = {
      P: '<ellipse cx="50" cy="84" rx="24" ry="7"/><path d="M36 78 C34 66 40 58 44 52 C34 48 30 38 38 30 C44 24 56 24 62 30 C70 38 66 48 56 52 C60 58 66 66 64 78 Z"/><circle cx="50" cy="22" r="13"/>',
      R: '<path d="M20 18 h16 v10 h8 v-10 h12 v10 h8 v-10 h16 v16 H20 Z"/><path d="M28 34 h44 v10 H28 Z"/><path d="M32 44 h36 v28 H32 Z"/><ellipse cx="50" cy="80" rx="32" ry="8"/>',
      N: '<path d="M16 48 C14 56 22 62 26 60 C18 70 22 80 30 84 L74 84 C80 84 78 74 72 70 L62 60 C76 54 82 40 74 30 C68 22 58 22 54 26 L62 10 L48 22 C40 14 30 20 30 32 C22 34 12 40 16 48 Z"/>',
      B: '<circle cx="50" cy="8" r="5"/><path d="M50 13 L58 30 L63 50 Q64 68 56 74 L44 74 Q36 68 37 50 L42 30 Z"/><ellipse cx="50" cy="76" rx="16" ry="4"/><ellipse cx="50" cy="84" rx="28" ry="7"/>',
      Q: '<circle cx="22" cy="30" r="7"/><circle cx="50" cy="16" r="7"/><circle cx="78" cy="30" r="7"/><path d="M16 36 L32 50 L28 76 H72 L68 50 L84 36 L66 46 L50 28 L34 46 Z"/><ellipse cx="50" cy="84" rx="30" ry="8"/>',
      K: '<path d="M46 2 h8 v10 h12 v8 H54 v8 h-8 v-8 H34 v-8 h12 z"/><path d="M26 36 h48 v9 H26 Z"/><path d="M32 45 C26 58 30 72 36 78 H64 C70 72 74 58 68 45 Z"/><ellipse cx="50" cy="84" rx="30" ry="8"/>'
    };
    function pieceMarkup(ch) {
      const black = ch !== ch.toUpperCase();
      const fill = black ? 'url(#fill-b)' : 'url(#fill-w)';
      const stroke = black ? '#242424' : '#8d8d8d';
      const shape = SHAPES[ch.toUpperCase()] || '';
      const slit = ch.toUpperCase() === 'B' ? '<path d="M48 28 h4 v22 h-4 z" fill="' + stroke + '" stroke="none"/>' : '';
      const eye = ch.toUpperCase() === 'N' ? '<circle cx="36" cy="40" r="2.6" fill="' + stroke + '" stroke="none"/>' : '';
      return '<svg class="piece" viewBox="0 0 100 100" aria-hidden="true"><g fill="' + fill + '" stroke="' + stroke + '" stroke-width="2.6" stroke-linejoin="round" filter="url(#piece-shadow)">' + shape + '</g>' + slit + eye + '</svg>';
    }
    let state = null;
    let selected = null;
    let lastMatchId = null;
    let prefs = { onboarded: true, games: ['chess'], multiplayer: true };
    let activeGame = 'chess';
    let sudo = null;
    let math = null;

    function fenToGrid(fen) {
      const placement = (fen || '').split(' ')[0] || '';
      const ranks = placement.split('/');
      const grid = [];
      for (const rank of ranks) {
        const row = [];
        for (const ch of rank) {
          if (ch >= '1' && ch <= '8') {
            for (let i = 0; i < Number(ch); i++) row.push(null);
          } else {
            row.push(ch);
          }
        }
        grid.push(row);
      }
      return grid;
    }

    function sqName(r, c) {
      return 'abcdefgh'[c] + (8 - r);
    }

    function render() {
      const match = state && state.match;
      const me = state && state.me;
      $('me').textContent = me ? ((me.ensName || me.displayName) + ' · ' + me.id) : '';
      if (activeGame !== 'chess') return;
      const waiting = state && state.seeking && (!match || match.status === 'finished');
      if (!match || waiting) {
        if (state && state.seeking) {
          $('subtitle').textContent = 'Waiting for the next person…';
          $('info').innerHTML = '<div>You are in the queue. When someone else hits <strong>Next</strong>, this board fills in.</div>';
        } else if (state && state.waiting > 0) {
          $('subtitle').textContent = 'Someone is waiting. Hit Next.';
          $('info').innerHTML = '<div>Next opens a game with the person already waiting. No room code.</div>';
        } else {
          $('subtitle').textContent = 'Hit Next to play whoever is waiting.';
          $('info').innerHTML = '<div>Next pairs you like Omegle. The first person waits. The next person starts the game.</div>';
        }
        $('board').innerHTML = '';
        paintClocks();
        return;
      }
      paintClocks();
      lastMatchId = match.matchId;
      const myColor = me && match.white === me.id ? 'w' : (me && match.black === me.id ? 'b' : null);
      $('subtitle').textContent = match.status + ' · turn ' + (match.turn === 'w' ? 'white' : 'black') +
        (myColor ? ' · you are ' + (myColor === 'w' ? 'white' : 'black') : '');
      $('info').innerHTML =
        '<div><strong>' + match.matchId + '</strong></div>' +
        '<div class="mono">W ' + match.white + '</div>' +
        '<div class="mono">B ' + match.black + '</div>' +
        (match.result ? '<div>' + JSON.stringify(match.result) + '</div>' : '');
      paintClocks();

      const grid = fenToGrid(match.fen);
      const board = $('board');
      board.innerHTML = '';
      const blackView = myColor === 'b';
      const rows = blackView ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
      const cols = blackView ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
      for (const r of rows) {
        for (const c of cols) {
          const sq = document.createElement('div');
          const light = (r + c) % 2 === 0;
          sq.className = 'sq ' + (light ? 'light' : 'dark');
          const name = sqName(r, c);
          sq.dataset.sq = name;
          const piece = grid[r][c];
          if (piece) sq.innerHTML = pieceMarkup(piece);
          const onLight = light;
          const leftEdge = blackView ? c === 7 : c === 0;
          const bottomEdge = blackView ? r === 0 : r === 7;
          if (leftEdge) {
            const rank = document.createElement('span');
            rank.className = 'coord rank ' + (onLight ? 'on-light' : 'on-dark');
            rank.textContent = String(8 - r);
            sq.append(rank);
          }
          if (bottomEdge) {
            const file = document.createElement('span');
            file.className = 'coord file ' + (onLight ? 'on-light' : 'on-dark');
            file.textContent = 'abcdefgh'[c];
            sq.append(file);
          }
          if (selected === name) sq.classList.add('selected');
          sq.onclick = () => onSquare(name, piece, myColor, match);
          board.append(sq);
        }
      }
    }

    function onSquare(name, piece, myColor, match) {
      if (match.status !== 'active') return;
      if (myColor && match.turn !== myColor) return;
      if (!selected) {
        if (!piece) return;
        const isWhite = piece === piece.toUpperCase();
        if (myColor === 'w' && !isWhite) return;
        if (myColor === 'b' && isWhite) return;
        selected = name;
        render();
        return;
      }
      if (selected === name) {
        selected = null;
        render();
        return;
      }
      const uci = selected + name;
      selected = null;
      vscode.postMessage({ type: 'move', matchId: match.matchId, uci });
    }

    function fmt(ms) {
      const s = Math.max(0, Math.floor(ms / 1000));
      return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }

    function fmtClock(ms) {
      const clamped = Math.max(0, ms);
      const total = Math.floor(clamped / 1000);
      const m = Math.floor(total / 60);
      const s = total % 60;
      const base = m + ':' + String(s).padStart(2, '0');
      if (clamped >= 10000) return base;
      return base + '.' + Math.floor((clamped % 1000) / 100);
    }

    function remaining(match, side) {
      let ms = match.clocksMs[side];
      if (match.status === 'active' && match.turn === side) {
        ms -= Date.now() - match.lastMoveAt;
      }
      return Math.max(0, ms);
    }

    function labelFor(id) {
      const me = state && state.me;
      if (me && id === me.id) return me.ensName || me.displayName || 'You';
      const peers = (state && state.peers) || [];
      const peer = peers.find((p) => p.id === id);
      return peer ? (peer.ensName || peer.displayName) : 'Opponent';
    }

    function paintClocks() {
      const match = state && state.match;
      const topBar = $('topBar');
      const botBar = $('botBar');
      const waiting = state && state.seeking && (!match || match.status === 'finished');
      if (!match || waiting) {
        topBar.style.display = 'none';
        botBar.style.display = 'none';
        return;
      }
      topBar.style.display = 'flex';
      botBar.style.display = 'flex';
      const me = state && state.me;
      const myColor = me && match.white === me.id ? 'w' : (me && match.black === me.id ? 'b' : null);
      const topColor = myColor === 'b' ? 'w' : 'b';
      const botColor = myColor === 'b' ? 'b' : 'w';
      $('topName').textContent = labelFor(topColor === 'w' ? match.white : match.black);
      $('botName').textContent = labelFor(botColor === 'w' ? match.white : match.black);
      const topMs = remaining(match, topColor);
      const botMs = remaining(match, botColor);
      $('topClock').textContent = fmtClock(topMs);
      $('botClock').textContent = fmtClock(botMs);
      $('topClock').className = 'clock' + (match.status === 'active' && match.turn === topColor ? ' run' : '') + (topMs < 20000 ? ' low' : '');
      $('botClock').className = 'clock' + (match.status === 'active' && match.turn === botColor ? ' run' : '') + (botMs < 20000 ? ' low' : '');
    }

    setInterval(() => { paintClocks(); tickMath(); }, 100);

    function rand(n) { return Math.floor(Math.random() * n); }
    function shuffle(list) {
      const a = list.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = rand(i + 1);
        const t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    }
    function digitOk(grid, r, c, n) {
      for (let i = 0; i < 9; i++) {
        if (grid[r][i] === n || grid[i][c] === n) return false;
      }
      const br = Math.floor(r / 3) * 3;
      const bc = Math.floor(c / 3) * 3;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        if (grid[br + i][bc + j] === n) return false;
      }
      return true;
    }
    function findEmpty(grid) {
      for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (!grid[r][c]) return [r, c];
      return null;
    }
    function fillGrid(grid) {
      const spot = findEmpty(grid);
      if (!spot) return true;
      const r = spot[0], c = spot[1];
      for (const n of shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9])) {
        if (!digitOk(grid, r, c, n)) continue;
        grid[r][c] = n;
        if (fillGrid(grid)) return true;
        grid[r][c] = 0;
      }
      return false;
    }
    function countSolutions(grid, limit) {
      const spot = findEmpty(grid);
      if (!spot) return 1;
      const r = spot[0], c = spot[1];
      let count = 0;
      for (let n = 1; n <= 9; n++) {
        if (!digitOk(grid, r, c, n)) continue;
        grid[r][c] = n;
        count += countSolutions(grid, limit - count);
        grid[r][c] = 0;
        if (count >= limit) return count;
      }
      return count;
    }
    function newSudoku() {
      const solved = Array.from({ length: 9 }, () => Array(9).fill(0));
      fillGrid(solved);
      const puzzle = solved.map((row) => row.slice());
      const order = shuffle(Array.from({ length: 81 }, (_, i) => i));
      let removed = 0;
      for (const idx of order) {
        if (removed >= 40) break;
        const r = Math.floor(idx / 9), c = idx % 9;
        const keep = puzzle[r][c];
        puzzle[r][c] = 0;
        if (countSolutions(puzzle, 2) !== 1) puzzle[r][c] = keep;
        else removed++;
      }
      sudo = { puzzle, solved };
      drawSudoku();
    }
    function drawSudoku() {
      const grid = $('sudoGrid');
      grid.innerHTML = '';
      $('sudoNote').textContent = '';
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          const input = document.createElement('input');
          input.maxLength = 1;
          input.inputMode = 'numeric';
          const given = sudo.puzzle[r][c];
          if (given) {
            input.value = String(given);
            input.readOnly = true;
            input.className = 'given';
          }
          if (c % 3 === 2 && c !== 8) input.classList.add('edge-r');
          if (r % 3 === 2 && r !== 8) input.classList.add('edge-b');
          input.oninput = () => {
            input.value = input.value.replace(/[^1-9]/g, '').slice(0, 1);
            markSudoku();
          };
          grid.append(input);
        }
      }
    }
    function markSudoku() {
      const inputs = $('sudoGrid').querySelectorAll('input');
      const grid = Array.from({ length: 9 }, () => Array(9).fill(0));
      inputs.forEach((input, i) => {
        grid[Math.floor(i / 9)][i % 9] = Number(input.value) || 0;
      });
      let filled = true;
      let solved = true;
      inputs.forEach((input, i) => {
        const r = Math.floor(i / 9), c = i % 9;
        const n = grid[r][c];
        if (!n) { filled = false; solved = false; }
        if (n && n !== sudo.solved[r][c]) solved = false;
        let bad = false;
        if (n && !input.readOnly) {
          grid[r][c] = 0;
          bad = !digitOk(grid, r, c, n);
          grid[r][c] = n;
        }
        input.classList.toggle('bad', bad);
      });
      $('sudoNote').textContent = solved && filled ? 'Solved.' : '';
    }
    function makeQuestion() {
      const kind = rand(4);
      let a, b, op, ans;
      if (kind === 0) { a = 12 + rand(80); b = 12 + rand(80); op = '+'; ans = a + b; }
      else if (kind === 1) { a = 30 + rand(60); b = 10 + rand(a - 15); op = '−'; ans = a - b; }
      else if (kind === 2) { a = 2 + rand(11); b = 2 + rand(11); op = '×'; ans = a * b; }
      else { b = 2 + rand(11); ans = 2 + rand(11); a = b * ans; op = '÷'; }
      return { text: a + ' ' + op + ' ' + b, ans };
    }
    function newMathRound() {
      math = { end: Date.now() + 120000, score: 0, streak: 0, q: makeQuestion(), over: false };
      $('mathAnswer').value = '';
      $('mathNote').textContent = '';
      $('mathAnswer').disabled = false;
      drawMath();
    }
    function drawMath() {
      if (!math) return;
      $('mathPrompt').textContent = math.over ? 'Time' : math.q.text;
      $('mathScore').textContent = 'Score ' + math.score + '  ·  streak ' + math.streak;
    }
    function tickMath() {
      if (!math || activeGame !== 'maths') return;
      const left = Math.max(0, math.end - Date.now());
      $('mathClock').textContent = fmtClock(left);
      $('mathClock').className = 'clock run' + (left < 20000 ? ' low' : '');
      if (left === 0 && !math.over) {
        math.over = true;
        $('mathAnswer').disabled = true;
        $('mathNote').textContent = 'Round over. Score ' + math.score + '.';
        drawMath();
      }
    }
    function submitMath() {
      if (!math || math.over) return;
      const raw = $('mathAnswer').value.trim();
      if (!raw) return;
      const value = Number(raw);
      if (value === math.q.ans) {
        math.score += 1;
        math.streak += 1;
        $('mathNote').textContent = 'Correct';
      } else {
        math.streak = 0;
        $('mathNote').textContent = 'It was ' + math.q.ans;
      }
      $('mathAnswer').value = '';
      math.q = makeQuestion();
      drawMath();
      $('mathAnswer').focus();
    }
    function showGame(game) {
      if (prefs.games.indexOf(game) === -1) game = prefs.games[0] || 'chess';
      activeGame = game;
      $('chessWrap').style.display = game === 'chess' ? '' : 'none';
      $('puzzleWrap').style.display = game === 'chess' ? 'none' : '';
      $('sudokuView').style.display = game === 'sudoku' ? '' : 'none';
      $('mathsView').style.display = game === 'maths' ? '' : 'none';
      const bar = $('gameBar');
      bar.innerHTML = '';
      const labels = { chess: 'Chess', sudoku: 'Sudoku', maths: 'Maths' };
      for (const id of prefs.games) {
        const b = document.createElement('button');
        b.textContent = labels[id] || id;
        if (id !== game) b.className = 'secondary';
        b.onclick = () => showGame(id);
        bar.append(b);
      }
      if (game === 'sudoku' && !sudo) newSudoku();
      if (game === 'maths' && !math) newMathRound();
      if (game === 'chess') render();
      else if (game === 'sudoku') $('subtitle').textContent = 'Sudoku. Each row, column, and box uses 1–9 once.';
      else $('subtitle').textContent = 'Maths. Two minutes. Answer as many as you can.';
    }
    const $ = (id) => document.getElementById(id);

    $('play').onclick = () => {
      const uci = $('uci').value.trim();
      if (!lastMatchId || !uci) return;
      vscode.postMessage({ type: 'move', matchId: lastMatchId, uci });
    };
    $('resign').onclick = () => {
      if (lastMatchId) vscode.postMessage({ type: 'resign', matchId: lastMatchId });
    };
    $('next').onclick = () => vscode.postMessage({ type: 'next' });
    $('refresh').onclick = () => vscode.postMessage({ type: 'refresh' });
    $('sudoNew').onclick = () => newSudoku();
    $('mathGo').onclick = () => submitMath();
    $('mathNew').onclick = () => newMathRound();
    $('mathAnswer').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submitMath();
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'prefs') {
        prefs = msg.prefs;
        showGame(prefs.games.indexOf(activeGame) === -1 ? prefs.games[0] : activeGame);
        return;
      }
      if (msg.type === 'play') {
        showGame(msg.game);
        return;
      }
      if (msg.type !== 'state') return;
      state = msg.state;
      selected = null;
      render();
    });
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}
