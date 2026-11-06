import * as vscode from "vscode";
import type { Credits } from "./credits";
import { MATE_PUZZLES } from "./mates";
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
    private readonly credits: Credits,
  ) {
    this.panel = panel;
    this.panel.webview.options = { enableScripts: true };
    this.panel.webview.html = this.html();

    this.unsub = this.bridge.onChange((state, kind) => this.postState(state, kind));

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
        case "snakeJoin":
          this.bridge.snakeJoin(typeof msg.code === "string" ? msg.code : undefined);
          break;
        case "snakeSteer":
          if (msg.dir === "up" || msg.dir === "down" || msg.dir === "left" || msg.dir === "right") {
            this.bridge.snakeSteer(msg.dir, Boolean(msg.boost));
          }
          break;
        case "snakeLeave":
          this.bridge.snakeLeave();
          break;
        case "ready":
          this.postPrefs(this.prefs.get());
          this.postState(this.bridge.state);
          if (this.pendingGame) {
            this.panel.webview.postMessage({ type: "deal", game: this.pendingGame });
          }
          break;
        case "solved": {
          const awarded = this.credits.award(String(msg.kind ?? ""), String(msg.id ?? ""));
          this.panel.webview.postMessage({ type: "credit", note: awarded.note });
          if (awarded.cents > 0) {
            vscode.window.setStatusBarMessage(`Session: ${awarded.note}`, 5000);
          }
          break;
        }
      }
    });

    this.unsubPrefs = this.prefs.onChange((prefs) => this.postPrefs(prefs));

    this.panel.onDidDispose(() => {
      this.unsub?.();
      this.unsubPrefs?.();
      BoardPanel.current = undefined;
    });
  }

  static show(bridge: RelayBridge, prefs: PrefsStore, credits: Credits, game?: GameId) {
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
    BoardPanel.current = new BoardPanel(panel, bridge, prefs, credits);
    if (game) BoardPanel.current.play(game);
    return BoardPanel.current;
  }

  play(game: GameId) {
    this.pendingGame = game;
    this.panel.webview.postMessage({ type: "play", game });
  }

  /** Open this game from an agent prompt. Solo puzzles deal only if none is in progress. */
  deal(game: GameId) {
    this.pendingGame = game;
    this.panel.webview.postMessage({ type: "deal", game });
  }

  private postPrefs(prefs: SessionPrefs) {
    this.panel.webview.postMessage({ type: "prefs", prefs });
  }

  private snakeStamp = "";

  private postState(state: UiState, kind?: "snake") {
    if (kind === "snake") {
      const snake = state.snake;
      const stamp = snake
        ? `${snake.matchId}:${snake.tick}:${snake.status}:${snake.players.length}:${snake.pellets.length}`
        : "";
      if (stamp === this.snakeStamp) return;
      this.snakeStamp = stamp;
      this.panel.webview.postMessage({ type: "snake", snake, me: state.me });
      return;
    }
    const snake = state.snake;
    this.snakeStamp = snake
      ? `${snake.matchId}:${snake.tick}:${snake.status}:${snake.players.length}:${snake.pellets.length}`
      : "";
    this.panel.webview.postMessage({ type: "state", state });
  }

  private html(): string {
    const mateJson = JSON.stringify(MATE_PUZZLES);
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
    .sq.hint { box-shadow: inset 0 0 0 5px rgba(246, 246, 105, 0.9); }
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
    .brainbar { display: flex; gap: 6px; margin-bottom: 8px; }
    .bank { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .bank button, .cross button.num, .maze button {
      min-width: 44px; height: 40px; margin: 0;
      font-weight: 750;
    }
    .bank button.on, .maze button.on { outline: 2px solid #f6f669; outline-offset: -2px; }
    .cross { display: grid; grid-template-columns: 48px 22px 48px 22px 48px 28px; gap: 4px 6px; align-items: center; width: max-content; }
    .cross .op, .cross .eq { text-align: center; font-weight: 700; }
    .cross button.num { width: 48px; background: #fff; color: #1a1a1a; }
    .cross button.num.given { background: #eeeed2; }
    .ken { display: grid; grid-template-columns: repeat(4, 58px); width: max-content; }
    .ken button {
      width: 58px; height: 58px; margin: 0; border-radius: 0;
      background: #fff; color: #1a1a1a; font-size: 18px; position: relative;
    }
    .ken .clab { position: absolute; top: 2px; left: 3px; font-size: 9px; font-weight: 700; opacity: 0.75; }
    .maze { display: grid; grid-template-columns: repeat(5, 48px); gap: 4px; width: max-content; }
    .maze button.opcell { background: #eeeed2; color: #1a1a1a; }
    .maze button.numcell { background: #fff; color: #1a1a1a; }
    .snake-canvas { width: min(100%, 520px); aspect-ratio: 1; background: #070b10; border-radius: 12px; display: block; }
    .snake-meta { margin-top: 8px; color: var(--muted, #9aa); font-size: 13px; }
    .snake-scores { list-style: none; padding: 0; margin: 8px 0 0; }
    .snake-scores li { display: flex; gap: 8px; align-items: center; margin: 4px 0; }
    .snake-scores i { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
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
  <div id="snakeWrap" style="display:none">
    <canvas id="snakeCanvas" class="snake-canvas" width="480" height="480" aria-label="Snake arena"></canvas>
    <div class="snake-meta" id="snakeStatus">Joining the open arena…</div>
    <ol class="snake-scores" id="snakeScores"></ol>
    <div class="actions" style="margin-top:8px">
      <button id="snakeJoin">Join arena</button>
      <button id="snakeLeave" class="secondary">Leave</button>
    </div>
    <div class="sub">Arrows or WASD to turn. Hold space to boost.</div>
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
      <div class="brainbar" id="brainBar"></div>
      <div class="sub" id="brainLead"></div>
      <div id="brainBoard"></div>
      <div id="brainBank" class="bank"></div>
      <div style="margin-top:8px">
        <button id="brainNew">New puzzle</button>
        <button id="brainUndo" class="secondary">Undo</button>
      </div>
      <div class="sub" id="brainNote"></div>
    </div>
    <div id="mateView" style="display:none">
      <div class="board" id="mateBoard"></div>
      <div class="actions" style="margin-top:8px">
        <button id="mateNew">New puzzle</button>
      </div>
      <div class="sub" id="mateNote"></div>
    </div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const MATES = ${mateJson};
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

    let mate = null;
    let matePick = null;
    function newMate() {
      beginPuzzle();
      let idx = Math.floor(Math.random() * MATES.length);
      if (mate && MATES.length > 1 && idx === mate.i) idx = (idx + 1) % MATES.length;
      mate = { i: idx, fen: MATES[idx].fen, mates: MATES[idx].mates, legal: MATES[idx].legal };
      matePick = null;
      drawMate();
    }
    function mateMovesFrom(square) {
      return (mate.legal || []).filter((move) => move.slice(0, 2) === square);
    }
    function mateChoice(stem) {
      const options = (mate.legal || []).filter((move) => move === stem || move.indexOf(stem) === 0);
      return options.find((move) => mate.mates.indexOf(move) !== -1) || options[0] || null;
    }
    function drawMate() {
      const board = $('mateBoard');
      const note = $('mateNote');
      if (!mate) {
        board.innerHTML = '';
        return;
      }
      note.textContent = '';
      $('subtitle').textContent = 'Mate in 1.';
      const side = mate.fen.split(' ')[1] === 'b' ? 'b' : 'w';
      const grid = fenToGrid(mate.fen);
      const hints = {};
      if (matePick) {
        for (const move of mateMovesFrom(matePick)) hints[move.slice(2, 4)] = true;
      }
      const blackView = side === 'b';
      const rows = blackView ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
      const cols = blackView ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
      board.innerHTML = '';
      for (const r of rows) {
        for (const c of cols) {
          const sq = document.createElement('div');
          const light = (r + c) % 2 === 0;
          sq.className = 'sq ' + (light ? 'light' : 'dark');
          const name = sqName(r, c);
          const piece = grid[r][c];
          if (piece) sq.innerHTML = pieceMarkup(piece);
          const leftEdge = blackView ? c === 7 : c === 0;
          const bottomEdge = blackView ? r === 0 : r === 7;
          if (leftEdge) {
            const rank = document.createElement('span');
            rank.className = 'coord rank ' + (light ? 'on-light' : 'on-dark');
            rank.textContent = String(8 - r);
            sq.append(rank);
          }
          if (bottomEdge) {
            const file = document.createElement('span');
            file.className = 'coord file ' + (light ? 'on-light' : 'on-dark');
            file.textContent = 'abcdefgh'[c];
            sq.append(file);
          }
          if (matePick === name) sq.classList.add('selected');
          if (hints[name]) sq.classList.add('hint');
          sq.onclick = () => onMateSquare(name, piece, side);
          board.append(sq);
        }
      }
    }
    function onMateSquare(name, piece, side) {
      if (!mate) return;
      const own = piece && ((side === 'w') === (piece === piece.toUpperCase()));
      if (!matePick) {
        if (!own || !mateMovesFrom(name).length) return;
        matePick = name;
        drawMate();
        return;
      }
      if (name === matePick) {
        matePick = null;
        drawMate();
        return;
      }
      if (own && mateMovesFrom(name).length) {
        matePick = name;
        drawMate();
        return;
      }
      const chosen = mateChoice(matePick + name);
      if (!chosen) return;
      const mating = mate.mates.indexOf(chosen) !== -1;
      matePick = null;
      if (mating) {
        nextSolved('mate');
        return;
      }
      drawMate();
      $('mateNote').textContent = 'Not mate.';
    }

    function render() {
      const match = state && state.match;
      const me = state && state.me;
      $('me').textContent = me ? ((me.ensName || me.displayName) + ' · ' + me.id) : '';
      if (activeGame !== 'chess') return;
      const waiting = state && state.seeking && (!match || match.status === 'finished');
      if (!match || waiting) {
        if (state && state.drawing) {
          $('subtitle').textContent = 'Drawing the opening on Base…';
          $('info').innerHTML = '<div>You are paired. VRF is choosing who plays white. The board opens when the word arrives.</div>';
        } else if (state && state.seeking) {
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

    setInterval(paintClocks, 100);

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
    let puzzleSerial = 0;
    let reportedSerial = 0;
    function beginPuzzle() {
      puzzleSerial += 1;
      reportedSerial = 0;
    }
    function reportSolve(kind) {
      if (reportedSerial === puzzleSerial) return false;
      reportedSerial = puzzleSerial;
      vscode.postMessage({ type: 'solved', kind: kind, id: kind + '-' + puzzleSerial });
      return true;
    }
    function nextSolved(kind) {
      if (!reportSolve(kind)) return;
      if (kind === 'sudoku') newSudoku();
      else if (kind === 'mate') newMate();
      else newBrain();
    }
    function newSudoku() {
      beginPuzzle();
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
      if (solved && filled) nextSolved('sudoku');
      else $('sudoNote').textContent = '';
    }
    let brainKind = 'cross';
    const BRAIN_OPS = ['+', '+', '−', '×', '×', '÷'];
    function applyOp(a, op, b) {
      if (op === '+') return a + b;
      if (op === '−') return a - b;
      if (op === '×') return a * b;
      if (op === '÷' && b && a % b === 0) return a / b;
      return null;
    }
    function evalExpr(a, op1, b, op2, c) {
      const high = (op) => op === '×' || op === '÷';
      let mid;
      if (!high(op1) && high(op2)) {
        mid = applyOp(b, op2, c);
        if (mid == null) return null;
        return applyOp(a, op1, mid);
      }
      mid = applyOp(a, op1, b);
      if (mid == null) return null;
      return applyOp(mid, op2, c);
    }
    function newCross() {
      for (let attempt = 0; attempt < 120; attempt++) {
        const nums = [0, 1, 2].map(() => [1 + rand(12), 1 + rand(12), 1 + rand(12)]);
        const rowOps = [0, 1, 2].map(() => [BRAIN_OPS[rand(BRAIN_OPS.length)], BRAIN_OPS[rand(BRAIN_OPS.length)]]);
        const colOps = [0, 1, 2].map(() => [BRAIN_OPS[rand(BRAIN_OPS.length)], BRAIN_OPS[rand(BRAIN_OPS.length)]]);
        const rowTargets = [];
        const colTargets = [];
        let ok = true;
        for (let r = 0; r < 3 && ok; r++) {
          const t = evalExpr(nums[r][0], rowOps[r][0], nums[r][1], rowOps[r][1], nums[r][2]);
          if (t == null || t < 0 || t > 250) ok = false;
          else rowTargets.push(t);
        }
        for (let c = 0; c < 3 && ok; c++) {
          const t = evalExpr(nums[0][c], colOps[c][0], nums[1][c], colOps[c][1], nums[2][c]);
          if (t == null || t < 0 || t > 250) ok = false;
          else colTargets.push(t);
        }
        if (!ok) continue;
        const hidden = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8]).slice(0, 5);
        const given = [0, 1, 2].map(() => [true, true, true]);
        const play = nums.map((row) => row.slice());
        const bank = [];
        for (const idx of hidden) {
          const r = Math.floor(idx / 3), c = idx % 3;
          given[r][c] = false;
          bank.push(nums[r][c]);
          play[r][c] = null;
        }
        math = { kind: 'cross', nums, given, play, bank, rowOps, colOps, rowTargets, colTargets, pick: null };
        return;
      }
      math = {
        kind: 'cross',
        nums: [[2, 3, 4], [1, 5, 2], [3, 1, 6]],
        given: [[true, false, true], [false, true, false], [true, false, true]],
        play: [[2, null, 4], [null, 5, null], [3, null, 6]],
        bank: [3, 1, 2, 1],
        rowOps: [['+', '+'], ['+', '+'], ['+', '+']],
        colOps: [['+', '+'], ['+', '+'], ['+', '+']],
        rowTargets: [9, 8, 10],
        colTargets: [6, 9, 12],
        pick: null,
      };
    }
    function newKenken() {
      const n = 4;
      const grid = Array.from({ length: n }, () => Array(n).fill(0));
      function bt(i) {
        if (i === n * n) return true;
        const r = Math.floor(i / n), c = i % n;
        for (const v of shuffle([1, 2, 3, 4])) {
          let used = false;
          for (let k = 0; k < n; k++) if (grid[r][k] === v || grid[k][c] === v) used = true;
          if (used) continue;
          grid[r][c] = v;
          if (bt(i + 1)) return true;
          grid[r][c] = 0;
        }
        return false;
      }
      bt(0);
      const seen = Array.from({ length: n }, () => Array(n).fill(false));
      const order = shuffle(Array.from({ length: n * n }, (_, i) => i));
      const cages = [];
      const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
      for (const idx of order) {
        const r = Math.floor(idx / n), c = idx % n;
        if (seen[r][c]) continue;
        const group = [[r, c]];
        seen[r][c] = true;
        const want = 1 + rand(3);
        while (group.length < want) {
          const frontier = [];
          for (const cell of group) {
            for (const d of dirs) {
              const nr = cell[0] + d[0], nc = cell[1] + d[1];
              if (nr < 0 || nc < 0 || nr >= n || nc >= n || seen[nr][nc]) continue;
              frontier.push([nr, nc]);
            }
          }
          if (!frontier.length) break;
          const next = frontier[rand(frontier.length)];
          seen[next[0]][next[1]] = true;
          group.push(next);
        }
        const vals = group.map(([rr, cc]) => grid[rr][cc]);
        let op = '';
        let target = vals[0];
        if (vals.length === 2) {
          const choices = ['+', '×'];
          if (vals[0] !== vals[1]) choices.push('−');
          if (vals[0] % vals[1] === 0 || vals[1] % vals[0] === 0) choices.push('÷');
          op = choices[rand(choices.length)];
          if (op === '+') target = vals[0] + vals[1];
          if (op === '×') target = vals[0] * vals[1];
          if (op === '−') target = Math.abs(vals[0] - vals[1]);
          if (op === '÷') target = Math.max(vals[0], vals[1]) / Math.min(vals[0], vals[1]);
        } else if (vals.length > 2) {
          op = rand(2) ? '+' : '×';
          target = op === '+' ? vals.reduce((a, b) => a + b, 0) : vals.reduce((a, b) => a * b, 1);
        }
        cages.push({ cells: group, op, target });
      }
      math = {
        kind: 'kenken',
        cages,
        play: Array.from({ length: n }, () => Array(n).fill(0)),
      };
    }
    function newMaze() {
      const n = 5;
      const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
      let found = null;
      function walk() {
        const seen = Array.from({ length: n }, () => Array(n).fill(false));
        const path = [[0, 0]];
        seen[0][0] = true;
        function dfs() {
          const cur = path[path.length - 1];
          if (cur[0] === n - 1 && cur[1] === n - 1) return path.length >= 7;
          const opts = shuffle(dirs.map(([dr, dc]) => [cur[0] + dr, cur[1] + dc]))
            .filter(([r, c]) => r >= 0 && c >= 0 && r < n && c < n && !seen[r][c]);
          for (const next of opts) {
            seen[next[0]][next[1]] = true;
            path.push(next);
            if (dfs()) return true;
            path.pop();
            seen[next[0]][next[1]] = false;
          }
          return false;
        }
        if (dfs()) found = path.map((cell) => cell.slice());
      }
      for (let i = 0; i < 30 && !found; i++) walk();
      if (!found) found = [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [4, 3], [4, 4]];
      const cells = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => (
        (r + c) % 2 === 0 ? { k: 'n', v: 1 + rand(9) } : { k: 'op', v: BRAIN_OPS[rand(4)] }
      )));
      let total = 2 + rand(7);
      cells[found[0][0]][found[0][1]] = { k: 'n', v: total };
      for (let i = 1; i < found.length; i++) {
        const cell = found[i];
        if (i % 2 === 1) {
          const opts = ['+', '×'];
          if (total > 4) opts.push('−');
          if ([2, 3, 4, 5].some((d) => total % d === 0)) opts.push('÷');
          cells[cell[0]][cell[1]] = { k: 'op', v: opts[rand(opts.length)] };
        } else {
          const op = cells[found[i - 1][0]][found[i - 1][1]].v;
          let num = 1 + rand(8);
          if (op === '−') num = 1 + rand(Math.max(1, Math.min(8, total - 1)));
          if (op === '×') num = 2 + rand(3);
          if (op === '÷') {
            const divs = [2, 3, 4, 5, 6, 7, 8, 9].filter((d) => total % d === 0);
            num = divs.length ? divs[rand(divs.length)] : 1;
            if (num === 1) cells[found[i - 1][0]][found[i - 1][1]].v = '+';
          }
          let next = applyOp(total, cells[found[i - 1][0]][found[i - 1][1]].v, num);
          if (next == null) {
            cells[found[i - 1][0]][found[i - 1][1]].v = '+';
            next = total + num;
          }
          total = next;
          cells[cell[0]][cell[1]] = { k: 'n', v: num };
        }
      }
      math = { kind: 'maze', cells, path: [[0, 0]], target: total };
    }
    function newBrain() {
      beginPuzzle();
      if (brainKind === 'kenken') newKenken();
      else if (brainKind === 'maze') newMaze();
      else newCross();
      drawBrain();
    }
    function brainLead() {
      if (!math) return '';
      if (math.kind === 'cross') return 'Cross Math. Drop the bank into the blanks. × and ÷ before + and −. Rows and columns must both hit their totals.';
      if (math.kind === 'kenken') return 'KenKen. Use 1–4 once in every row and column. Each outlined cage has to make its target.';
      return 'Math maze. Trace a path from S to E. Numbers and operators alternate, worked left to right, and must land on ' + math.target + '.';
    }
    function drawBrainBar() {
      const bar = $('brainBar');
      bar.innerHTML = '';
      const modes = [['cross', 'Cross Math'], ['kenken', 'KenKen'], ['maze', 'Maze']];
      for (const pair of modes) {
        const b = document.createElement('button');
        b.textContent = pair[1];
        if (pair[0] !== brainKind) b.className = 'secondary';
        b.onclick = () => { brainKind = pair[0]; newBrain(); };
        bar.append(b);
      }
    }
    function drawBrain() {
      drawBrainBar();
      $('brainLead').textContent = brainLead();
      $('brainNote').textContent = '';
      $('brainBank').innerHTML = '';
      const board = $('brainBoard');
      board.innerHTML = '';
      if (!math) return;
      if (math.kind === 'cross') drawCross(board);
      else if (math.kind === 'kenken') drawKenken(board);
      else drawMaze(board);
    }
    function drawCross(board) {
      const wrap = document.createElement('div');
      wrap.className = 'cross';
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          const btn = document.createElement('button');
          btn.className = 'num' + (math.given[r][c] ? ' given' : '');
          btn.textContent = math.play[r][c] == null ? '' : String(math.play[r][c]);
          const rr = r, cc = c;
          btn.onclick = () => placeCross(rr, cc);
          wrap.append(btn);
          if (c < 2) {
            const op = document.createElement('div');
            op.className = 'op';
            op.textContent = math.rowOps[r][c];
            wrap.append(op);
          }
        }
        const eq = document.createElement('div');
        eq.className = 'eq';
        eq.textContent = '= ' + math.rowTargets[r];
        wrap.append(eq);
        if (r < 2) {
          for (let c = 0; c < 3; c++) {
            const op = document.createElement('div');
            op.className = 'op';
            op.textContent = math.colOps[c][r];
            wrap.append(op);
            if (c < 2) wrap.append(document.createElement('div'));
          }
          wrap.append(document.createElement('div'));
        }
      }
      for (let c = 0; c < 3; c++) {
        const eq = document.createElement('div');
        eq.className = 'eq';
        eq.textContent = '= ' + math.colTargets[c];
        wrap.append(eq);
        if (c < 2) wrap.append(document.createElement('div'));
      }
      board.append(wrap);
      math.bank.forEach((n, i) => {
        const chip = document.createElement('button');
        chip.textContent = String(n);
        if (math.pick === i) chip.className = 'on';
        chip.onclick = () => { math.pick = math.pick === i ? null : i; drawBrain(); };
        $('brainBank').append(chip);
      });
      if (crossFull() && crossOk()) nextSolved('cross');
    }
    function placeCross(r, c) {
      if (math.given[r][c]) return;
      if (math.play[r][c] != null) {
        math.bank.push(math.play[r][c]);
        math.play[r][c] = null;
        math.pick = null;
        drawBrain();
        return;
      }
      if (math.pick == null) return;
      math.play[r][c] = math.bank.splice(math.pick, 1)[0];
      math.pick = null;
      drawBrain();
    }
    function crossFull() {
      return math.play.every((row) => row.every((v) => v != null));
    }
    function crossOk() {
      for (let r = 0; r < 3; r++) {
        if (evalExpr(math.play[r][0], math.rowOps[r][0], math.play[r][1], math.rowOps[r][1], math.play[r][2]) !== math.rowTargets[r]) return false;
      }
      for (let c = 0; c < 3; c++) {
        if (evalExpr(math.play[0][c], math.colOps[c][0], math.play[1][c], math.colOps[c][1], math.play[2][c]) !== math.colTargets[c]) return false;
      }
      return true;
    }
    function drawKenken(board) {
      const wrap = document.createElement('div');
      wrap.className = 'ken';
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          const btn = document.createElement('button');
          const cage = math.cages.find((item) => item.cells.some((cell) => cell[0] === r && cell[1] === c));
          const first = cage.cells.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])[0];
          btn.textContent = math.play[r][c] ? String(math.play[r][c]) : '';
          if (first[0] === r && first[1] === c) {
            const lab = document.createElement('span');
            lab.className = 'clab';
            lab.textContent = cage.target + cage.op;
            btn.append(lab);
          }
          const id = math.cages.indexOf(cage);
          const edge = (nr, nc) => {
            if (nr < 0 || nc < 0 || nr > 3 || nc > 3) return '3px solid #262421';
            const other = math.cages.findIndex((item) => item.cells.some((cell) => cell[0] === nr && cell[1] === nc));
            return other === id ? '1px solid #ddd' : '3px solid #262421';
          };
          btn.style.borderTop = edge(r - 1, c);
          btn.style.borderRight = edge(r, c + 1);
          btn.style.borderBottom = edge(r + 1, c);
          btn.style.borderLeft = edge(r, c - 1);
          const rr = r, cc = c;
          btn.onclick = () => {
            math.play[rr][cc] = (math.play[rr][cc] + 1) % 5;
            drawBrain();
          };
          wrap.append(btn);
        }
      }
      board.append(wrap);
      if (kenkenOk()) nextSolved('kenken');
    }
    function kenkenOk() {
      const g = math.play;
      for (let r = 0; r < 4; r++) {
        const row = new Set();
        const col = new Set();
        for (let c = 0; c < 4; c++) {
          if (!g[r][c] || !g[c][r]) return false;
          row.add(g[r][c]);
          col.add(g[c][r]);
        }
        if (row.size !== 4 || col.size !== 4) return false;
      }
      return math.cages.every((cage) => {
        const vals = cage.cells.map((cell) => g[cell[0]][cell[1]]);
        if (!cage.op) return vals[0] === cage.target;
        if (cage.op === '+') return vals.reduce((a, b) => a + b, 0) === cage.target;
        if (cage.op === '×') return vals.reduce((a, b) => a * b, 1) === cage.target;
        if (cage.op === '−') return Math.abs(vals[0] - vals[1]) === cage.target;
        const a = vals[0], b = vals[1];
        if (!b || !a) return false;
        return (a % b === 0 ? a / b : b / a) === cage.target;
      });
    }
    function mazeValue() {
      const path = math.path;
      const start = math.cells[path[0][0]][path[0][1]];
      if (start.k !== 'n') return null;
      let total = start.v;
      for (let i = 1; i < path.length; i += 2) {
        if (!path[i + 1]) return null;
        const op = math.cells[path[i][0]][path[i][1]];
        const num = math.cells[path[i + 1][0]][path[i + 1][1]];
        if (op.k !== 'op' || num.k !== 'n') return null;
        total = applyOp(total, op.v, num.v);
        if (total == null) return null;
      }
      return path.length % 2 === 1 ? total : null;
    }
    function drawMaze(board) {
      const wrap = document.createElement('div');
      wrap.className = 'maze';
      const onPath = new Set(math.path.map((cell) => cell[0] + ',' + cell[1]));
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          const cell = math.cells[r][c];
          const btn = document.createElement('button');
          btn.className = cell.k === 'op' ? 'opcell' : 'numcell';
          if (onPath.has(r + ',' + c)) btn.classList.add('on');
          let label = String(cell.v);
          if (r === 0 && c === 0) label = 'S ' + label;
          if (r === 4 && c === 4) label = label + ' E';
          btn.textContent = label;
          const rr = r, cc = c;
          btn.onclick = () => stepMaze(rr, cc);
          wrap.append(btn);
        }
      }
      board.append(wrap);
      const now = mazeValue();
      const mazeSolved = now === math.target && math.path[math.path.length - 1][0] === 4 && math.path[math.path.length - 1][1] === 4;
      if (mazeSolved) nextSolved('maze');
      else $('brainNote').textContent = now == null
        ? 'Running total updates after each number.'
        : 'Now ' + now + '  ·  target ' + math.target;
    }
    function stepMaze(r, c) {
      const path = math.path;
      const last = path[path.length - 1];
      if (last[0] === r && last[1] === c) {
        if (path.length > 1) path.pop();
        drawBrain();
        return;
      }
      if (Math.abs(last[0] - r) + Math.abs(last[1] - c) !== 1) return;
      if (path.some((cell) => cell[0] === r && cell[1] === c)) return;
      path.push([r, c]);
      drawBrain();
    }
    function undoBrain() {
      if (!math) return;
      if (math.kind === 'maze') {
        if (math.path.length > 1) math.path.pop();
        drawBrain();
        return;
      }
      if (math.kind === 'cross') {
        for (let r = 2; r >= 0; r--) for (let c = 2; c >= 0; c--) {
          if (!math.given[r][c] && math.play[r][c] != null) {
            math.bank.push(math.play[r][c]);
            math.play[r][c] = null;
            math.pick = null;
            drawBrain();
            return;
          }
        }
      }
      if (math.kind === 'kenken') {
        for (let r = 3; r >= 0; r--) for (let c = 3; c >= 0; c--) {
          if (math.play[r][c]) {
            math.play[r][c] = 0;
            drawBrain();
            return;
          }
        }
      }
    }
    let snakeDir = null;
    let snakeBoost = false;
    let snakeSent = '';
    const snakePressed = [];
    const snakePose = new Map();
    let snakeSim = null;
    let snakeSeenAt = 0;
    let snakeScoreSig = '';
    let snakeClock = '';
    let snakeGrid = null;
    let snakeGridKey = '';
    function snakeHeadline(match) {
      if (!match) return 'Joining the open arena…';
      if (match.status === 'waiting') return 'Room ' + match.roomCode + ' · waiting for another snake';
      if (match.status === 'finished') {
        if (match.result && match.result.kind === 'draw') return 'Draw';
        const winner = (match.players || []).find((p) => match.result && p.id === match.result.winner);
        const name = winner ? winner.name : 'Someone';
        return name + ' wins' + (match.result && match.result.reason === 'last' ? ' — last one in' : '');
      }
      const left = Math.max(0, (match.endsAt || Date.now()) - Date.now());
      const secs = Math.floor(left / 1000);
      const me = (match.players || []).find((p) => state.me && p.id === state.me.id);
      return match.roomCode + ' · ' + Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0') + (me && !me.alive ? ' · respawning' : '');
    }
    const SNAKE_TICK = 110;
    const SNAKE_LEAD = 5;
    const SNAKE_STEP = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
    function oppositeDir(dir) {
      if (dir === 'up') return 'down';
      if (dir === 'down') return 'up';
      if (dir === 'left') return 'right';
      return 'left';
    }
    function copyBody(body) {
      return body.map((cell) => ({ x: cell.x, y: cell.y }));
    }
    function stepBody(body, dir) {
      const head = body[0];
      if (!head) return body;
      const delta = SNAKE_STEP[dir] || SNAKE_STEP.right;
      const next = [{ x: head.x + delta.x, y: head.y + delta.y }].concat(body);
      next.pop();
      return next;
    }
    function slideBody(body, dir, frac) {
      if (frac <= 0 || !body.length) return body;
      const delta = SNAKE_STEP[dir] || SNAKE_STEP.right;
      const out = [{ x: body[0].x + delta.x * frac, y: body[0].y + delta.y * frac }];
      for (let i = 1; i < body.length; i++) {
        out.push({
          x: body[i].x + (body[i - 1].x - body[i].x) * frac,
          y: body[i].y + (body[i - 1].y - body[i].y) * frac,
        });
      }
      return out;
    }
    function leadOf(head, server, dir) {
      const delta = SNAKE_STEP[dir] || SNAKE_STEP.right;
      return (head.x - server.x) * delta.x + (head.y - server.y) * delta.y;
    }
    function reconcileSim(server, dir) {
      const head = snakeSim.body[0];
      const serverHead = server[0];
      if (!head || !serverHead) {
        snakeSim.body = copyBody(server);
        snakeSim.dir = dir;
        snakeSim.acc = 0;
        return;
      }
      const dx = head.x - serverHead.x;
      const dy = head.y - serverHead.y;
      if (dx * dx + dy * dy > 16) {
        snakeSim.body = copyBody(server);
        snakeSim.dir = dir;
        snakeSim.acc = 0;
        return;
      }
      const grew = server.length - snakeSim.body.length;
      if (grew === 0) return;
      if (grew > 0 && grew <= 2) {
        const tail = snakeSim.body[snakeSim.body.length - 1] || head;
        for (let i = 0; i < grew; i++) snakeSim.body.push({ x: tail.x, y: tail.y });
        return;
      }
      if (grew < 0 && snakeSim.body.length + grew >= 2) {
        snakeSim.body = snakeSim.body.slice(0, server.length);
        return;
      }
      snakeSim.body = copyBody(server);
      snakeSim.acc = 0;
    }
    function advanceSim(serverHead, want, boost, dt) {
      const hops = boost && snakeSim.body.length > 10 ? 2 : 1;
      const maxLead = hops * SNAKE_LEAD;
      snakeSim.acc += dt;
      let guard = 0;
      while (snakeSim.acc >= SNAKE_TICK && snakeSim.body[0] && guard < 4) {
        const dir = want !== oppositeDir(snakeSim.dir) ? want : snakeSim.dir;
        if (leadOf(snakeSim.body[0], serverHead, dir) >= maxLead) break;
        snakeSim.dir = dir;
        snakeSim.acc -= SNAKE_TICK;
        guard += 1;
        for (let hop = 0; hop < hops; hop++) snakeSim.body = stepBody(snakeSim.body, snakeSim.dir);
      }
      if (snakeSim.acc > SNAKE_TICK) snakeSim.acc = SNAKE_TICK;
      const head = snakeSim.body[0];
      const frac = head && leadOf(head, serverHead, snakeSim.dir) >= maxLead ? 0 : Math.min(snakeSim.acc / SNAKE_TICK, 1);
      return slideBody(snakeSim.body, snakeSim.dir, frac);
    }
    function extrapolate(body, dir, ageMs) {
      const extra = Math.min(Math.max(0, ageMs) / SNAKE_TICK, 1.6);
      let pts = copyBody(body);
      const whole = Math.floor(extra);
      for (let i = 0; i < whole; i++) pts = stepBody(pts, dir);
      return slideBody(pts, dir, extra - whole);
    }
    function easeToward(prev, next, dt) {
      if (!prev || prev.length !== next.length) return next;
      const slow = 1 - Math.exp(-dt / 36);
      const fast = 1 - Math.exp(-dt / 16);
      const out = [];
      for (let i = 0; i < next.length; i++) {
        const cell = next[i];
        const cur = prev[i];
        const dx = cell.x - cur.x;
        const dy = cell.y - cur.y;
        const dist = dx * dx + dy * dy;
        if (dist > 64) {
          out.push({ x: cell.x, y: cell.y });
          continue;
        }
        const k = dist > 6.25 ? fast : slow;
        out.push({ x: cur.x + dx * k, y: cur.y + dy * k });
      }
      return out;
    }
    function poseOf(player, dt, age, matchId) {
      const next = player.body || [];
      const mine = state.me && player.id === state.me.id;
      if (!next.length || !player.alive) {
        if (mine) snakeSim = null;
        snakePose.delete(player.id);
        return [];
      }
      if (mine) {
        const want = snakeDir && snakeDir !== oppositeDir(player.dir) ? snakeDir : player.dir;
        if (!snakeSim || snakeSim.matchId !== matchId) {
          snakeSim = { matchId: matchId, body: copyBody(next), dir: want, acc: 0 };
        } else {
          reconcileSim(next, player.dir);
        }
        const drawn = advanceSim(next[0], want, snakeBoost && next.length > 10, dt || 16);
        snakePose.set(player.id, drawn);
        return drawn;
      }
      const target = extrapolate(next, player.dir, age);
      const eased = easeToward(snakePose.get(player.id), target, dt || 16);
      snakePose.set(player.id, eased);
      return eased;
    }
    function syncSnakeHud(match) {
      const clock = snakeHeadline(match);
      if (clock !== snakeClock) {
        snakeClock = clock;
        $('snakeStatus').textContent = clock;
      }
      if (!match) {
        if (snakeScoreSig) {
          snakeScoreSig = '';
          $('snakeScores').innerHTML = '';
        }
        return;
      }
      const sig = (match.players || []).map((player) => player.id + ':' + player.score + ':' + (player.alive ? 1 : 0)).join('|');
      if (sig === snakeScoreSig) return;
      snakeScoreSig = sig;
      const list = $('snakeScores');
      list.innerHTML = '';
      const ranked = (match.players || []).slice().sort((a, b) => b.score - a.score);
      for (const player of ranked) {
        const li = document.createElement('li');
        li.innerHTML = '<i></i><span></span><strong></strong>';
        li.children[0].style.background = player.color;
        li.children[1].textContent = player.name + (state.me && player.id === state.me.id ? ' (you)' : '');
        li.children[2].textContent = String(player.score);
        list.append(li);
      }
    }
    function drawSnake(dt) {
      const canvas = $('snakeCanvas');
      if (!state) {
        $('snakeStatus').textContent = 'Connecting…';
        return;
      }
      const match = state.snake;
      syncSnakeHud(match);
      if (!match) return;
      const css = canvas.clientWidth;
      if (css < 10) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const px = Math.floor(css * dpr);
      if (canvas.width !== px || canvas.height !== px) {
        canvas.width = px;
        canvas.height = px;
      }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, css, css);
      ctx.fillStyle = '#070b10';
      ctx.fillRect(0, 0, css, css);
      const gridKey = css + 'x' + match.width + 'x' + match.height;
      if (snakeGridKey !== gridKey) {
        snakeGrid = document.createElement('canvas');
        snakeGrid.width = Math.floor(css);
        snakeGrid.height = Math.floor(css);
        const g = snakeGrid.getContext('2d');
        const step = css / match.width;
        g.strokeStyle = 'rgba(255,255,255,0.05)';
        g.beginPath();
        for (let i = 1; i < match.width; i++) {
          g.moveTo(Math.round(i * step) + 0.5, 0);
          g.lineTo(Math.round(i * step) + 0.5, css);
        }
        for (let i = 1; i < match.height; i++) {
          g.moveTo(0, Math.round(i * step) + 0.5);
          g.lineTo(css, Math.round(i * step) + 0.5);
        }
        g.stroke();
        snakeGridKey = gridKey;
      }
      ctx.drawImage(snakeGrid, 0, 0, css, css);
      const cell = css / match.width;
      for (const pellet of match.pellets || []) {
        ctx.fillStyle = pellet.value > 1 ? '#fde68a' : '#fbbf24';
        ctx.beginPath();
        ctx.arc(pellet.x * cell + cell / 2, pellet.y * cell + cell / 2, (pellet.value > 1 ? 0.28 : 0.16) * cell, 0, Math.PI * 2);
        ctx.fill();
      }
      const seen = new Set();
      const age = snakeSeenAt ? performance.now() - snakeSeenAt : 0;
      for (const player of match.players || []) {
        seen.add(player.id);
        const body = poseOf(player, dt || 16, age, match.matchId);
        if (body.length < 1) continue;
        ctx.globalAlpha = player.alive ? 1 : 0.35;
        ctx.strokeStyle = player.color;
        ctx.fillStyle = player.color;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = cell * 0.72;
        if (body.length > 1) {
          ctx.beginPath();
          ctx.moveTo(body[0].x * cell + cell / 2, body[0].y * cell + cell / 2);
          for (let i = 1; i < body.length; i++) ctx.lineTo(body[i].x * cell + cell / 2, body[i].y * cell + cell / 2);
          ctx.stroke();
        }
        const head = body[0];
        const hx = head.x * cell + cell / 2;
        const hy = head.y * cell + cell / 2;
        ctx.beginPath();
        ctx.arc(hx, hy, cell * 0.42, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      for (const id of Array.from(snakePose.keys())) if (!seen.has(id)) snakePose.delete(id);
    }
    function sendSnake(dir, boost) {
      if (dir) snakeDir = dir;
      snakeBoost = !!boost;
      const heading = dir || snakeDir;
      if (!heading) return;
      const stamp = heading + (snakeBoost ? ':1' : ':0');
      if (stamp === snakeSent) return;
      snakeSent = stamp;
      vscode.postMessage({ type: 'snakeSteer', dir: heading, boost: snakeBoost });
    }
    function pressSnake(dir, down) {
      const at = snakePressed.indexOf(dir);
      if (down) {
        if (at >= 0) snakePressed.splice(at, 1);
        snakePressed.push(dir);
      } else if (at >= 0) snakePressed.splice(at, 1);
      return snakePressed.length ? snakePressed[snakePressed.length - 1] : null;
    }
    function showGame(game) {
      if (prefs.games.indexOf(game) === -1) game = prefs.games[0] || 'chess';
      activeGame = game;
      $('chessWrap').style.display = game === 'chess' ? '' : 'none';
      $('snakeWrap').style.display = game === 'snakes' ? '' : 'none';
      $('puzzleWrap').style.display = game === 'chess' || game === 'snakes' ? 'none' : '';
      $('sudokuView').style.display = game === 'sudoku' ? '' : 'none';
      $('mathsView').style.display = game === 'maths' ? '' : 'none';
      $('mateView').style.display = game === 'mate' ? '' : 'none';
      const bar = $('gameBar');
      bar.innerHTML = '';
      const labels = { chess: 'Chess', snakes: 'Snakes', sudoku: 'Sudoku', maths: 'Maths', mate: 'Mate in 1' };
      for (const id of prefs.games) {
        const b = document.createElement('button');
        b.textContent = labels[id] || id;
        if (id !== game) b.className = 'secondary';
        b.onclick = () => showGame(id);
        bar.append(b);
      }
      if (game === 'sudoku' && !sudo) newSudoku();
      if (game === 'maths' && !math) newBrain();
      if (game === 'mate' && !mate) newMate();
      if (game === 'chess') render();
      else if (game === 'snakes') {
        $('subtitle').textContent = 'Snakes. Leave the code blank and everyone shares one arena.';
        vscode.postMessage({ type: 'snakeJoin', code: 'OPEN' });
        drawSnake();
      }
      else if (game === 'sudoku') $('subtitle').textContent = 'Sudoku. Each row, column, and box uses 1–9 once.';
      else if (game === 'mate') {
        $('subtitle').textContent = 'Mate in 1.';
        if (mate) drawMate();
      }
      else $('subtitle').textContent = 'Maths. Cross Math, KenKen, or a number maze.';
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
    $('brainNew').onclick = () => newBrain();
    $('brainUndo').onclick = () => undoBrain();
    $('mateNew').onclick = () => newMate();
    $('snakeJoin').onclick = () => vscode.postMessage({ type: 'snakeJoin', code: 'OPEN' });
    $('snakeLeave').onclick = () => vscode.postMessage({ type: 'snakeLeave' });
    function snakeKeyDir(event) {
      const key = event.key.toLowerCase();
      if (key === 'arrowup' || key === 'w') return 'up';
      if (key === 'arrowdown' || key === 's') return 'down';
      if (key === 'arrowleft' || key === 'a') return 'left';
      if (key === 'arrowright' || key === 'd') return 'right';
      return null;
    }
    window.addEventListener('keydown', (event) => {
      if (activeGame !== 'snakes' || event.repeat) return;
      if (event.code === 'Space') {
        event.preventDefault();
        sendSnake(snakeDir, true);
        return;
      }
      const dir = snakeKeyDir(event);
      if (!dir) return;
      event.preventDefault();
      const next = pressSnake(dir, true);
      if (next) sendSnake(next, snakeBoost);
    });
    window.addEventListener('keyup', (event) => {
      if (activeGame !== 'snakes') return;
      if (event.code === 'Space') {
        sendSnake(snakeDir, false);
        return;
      }
      const dir = snakeKeyDir(event);
      if (!dir) return;
      const next = pressSnake(dir, false);
      if (next) sendSnake(next, snakeBoost);
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
      if (msg.type === 'credit') return;
      if (msg.type === 'deal') {
        showGame(msg.game);
        if (msg.game === 'sudoku' && (!sudo || $('sudoNote').textContent === 'Solved.')) newSudoku();
        if (msg.game === 'maths' && (!math || $('brainNote').textContent.indexOf('Solved') !== -1)) newBrain();
        if (msg.game === 'mate' && !mate) newMate();
        if (msg.game === 'snakes') vscode.postMessage({ type: 'snakeJoin', code: 'OPEN' });
        return;
      }
      if (msg.type === 'snake') {
        if (!state) state = { snake: msg.snake, me: msg.me };
        else {
          state.snake = msg.snake;
          if (msg.me) state.me = msg.me;
        }
        snakeSeenAt = performance.now();
        return;
      }
      if (msg.type !== 'state') return;
      state = msg.state;
      if (state && state.snake) snakeSeenAt = performance.now();
      if (activeGame === 'snakes') return;
      selected = null;
      render();
    });
    let snakeLast = 0;
    function snakeFrame(now) {
      requestAnimationFrame(snakeFrame);
      if (activeGame !== 'snakes') return;
      const dt = snakeLast ? Math.min(48, now - snakeLast) : 16;
      snakeLast = now;
      drawSnake(dt);
    }
    requestAnimationFrame(snakeFrame);
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}
