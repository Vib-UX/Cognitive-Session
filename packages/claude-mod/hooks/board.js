/**
 * Surface module for the Session pane: the playable region.
 * Chess draws a colored board; a click or arrows + Enter picks squares.
 * Flappy flies locally on this machine. A click, space, or the up arrow flaps.
 * The final score is posted once. It holds no relay connection.
 */

import { BIRD_X, BOARD_H, BOARD_W, beginRound, birdRow, flap, gapSize, stepRound } from "./flappy.js";

const GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };

const LIGHT = "#e3cfa6";
const DARK = "#a97d55";
const LIGHT_SEL = "#f0dc7c";
const DARK_SEL = "#cfa947";
const LAST_LIGHT = "#cfd88a";
const LAST_DARK = "#a8b45a";
const CURSOR = "#6aa6d8";
const WHITE_PIECE = "#ffffff";
const BLACK_PIECE = "#111111";
const DOT = "#3f5f2a";
const CAPTURE = "#b91c1c";

const SKY = "#0b1220";
const PIPE = "#22c55e";
const PIPE_INK = "#14532d";
const BIRD = "#fde047";
const BIRD_INK = "#111111";
const CRASH = "#ef4444";

function piecesFromFen(fen) {
  const map = {};
  if (!fen) return map;
  const ranks = String(fen).split(" ")[0].split("/");
  for (let r = 0; r < ranks.length; r++) {
    let file = 0;
    for (const ch of ranks[r]) {
      if (ch >= "1" && ch <= "8") {
        file += Number(ch);
      } else {
        map["abcdefgh"[file] + (8 - r)] = ch;
        file += 1;
      }
    }
  }
  return map;
}

/**
 * Square sizes, smallest first: cells wide x rows tall, and the sprite drawn
 * inside (null keeps one glyph). Each is about square on screen.
 */
const SIZES = [
  { cellW: 3, cellH: 1, sprite: null },
  { cellW: 5, cellH: 2, sprite: null },
  { cellW: 7, cellH: 3, sprite: "m" },
  { cellW: 9, cellH: 4, sprite: "l" },
];

/** The biggest size that fits the pane, capped by the zoom the person picked. */
function chessLayout(props, columns) {
  const flip = props.color === "b";
  const files = flip ? "hgfedcba".split("") : "abcdefgh".split("");
  const ranks = flip ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
  const room = (columns || 26) - 2;
  let fit = 0;
  while (fit + 1 < SIZES.length && SIZES[fit + 1].cellW * 8 <= room) fit += 1;
  const zoom = Number.isInteger(props.zoom) ? Math.max(0, props.zoom) : SIZES.length - 1;
  const size = SIZES[Math.min(fit, zoom)];
  return { files, ranks, ...size, sprite: props.letters ? null : size.sprite };
}

// Pieces in quadrant pixels: each pixel is half a cell wide, half a row tall.
const ART = {
  m: {
    p: ["..........", "....##....", "...####...", "....##....", "...####...", "..######.."],
    r: [".##.##.##.", ".########.", "..######..", "..######..", ".########.", ".########."],
    n: ["....#.#...", "...#####..", ".#######..", ".##.####..", "...#####..", ".########."],
    b: ["....##....", "...####...", "..###.##..", "...####...", "....##....", ".########."],
    q: [".#..##..#.", ".########.", "..######..", "...####...", "..######..", ".########."],
    k: ["....##....", "..######..", "....##....", ".########.", "..######..", ".########."],
  },
  l: {
    p: ["..............", "......##......", ".....####.....", "......##......", ".....####.....", "....######....", "...########...", "...########..."],
    r: ["..##..##..##..", "..##########..", "...########...", "....######....", "....######....", "...########...", "..##########..", "..##########.."],
    n: ["......##.##...", ".....#######..", "...#########..", "..##########..", "..###.######..", ".....#######..", "....########..", "..##########.."],
    b: ["......##......", ".....####.....", "....###.##....", "....##.###....", ".....####.....", "......##......", "....######....", "..##########.."],
    q: [".#...#..#...#.", ".##.##..##.##.", "..##########..", "...########...", "....######....", "...########...", "..##########..", "..##########.."],
    k: ["......##......", "....######....", "......##......", "..##########..", "...########...", "....######....", "...########...", "..##########.."],
  },
};

// Index: top-left 8, top-right 4, bottom-left 2, bottom-right 1.
const QUAD = " ▗▖▄▝▐▞▟▘▚▌▙▀▜▛█";

/** One string per terminal row for a piece's sprite. */
const SPRITES = {};
for (const [size, set] of Object.entries(ART)) {
  SPRITES[size] = {};
  for (const [piece, px] of Object.entries(set)) {
    const lines = [];
    for (let y = 0; y < px.length; y += 2) {
      let line = "";
      for (let x = 0; x < px[y].length; x += 2) {
        const on = (r, c) => (px[r] && px[r][c] === "#" ? 1 : 0);
        line += QUAD[on(y, x) * 8 + on(y, x + 1) * 4 + on(y + 1, x) * 2 + on(y + 1, x + 1)];
      }
      lines.push(line);
    }
    SPRITES[size][piece] = lines;
  }
}

function center(text, width) {
  const left = Math.floor((width - 1) / 2);
  return " ".repeat(left) + text + " ".repeat(width - left - 1);
}

function drawChess(props, state, surface) {
  const { Box, Text } = surface.elements;
  const { files, ranks, cellW, cellH, sprite } = chessLayout(props, surface.columns);
  const pieces = piecesFromFen(props.fen);
  const dests = new Set(props.dests || []);
  const last = props.lastMove ? [props.lastMove.slice(0, 2), props.lastMove.slice(2, 4)] : [];
  const rows = [];

  ranks.forEach((rank, ri) => {
    for (let line = 0; line < cellH; line++) {
      const mid = line === Math.floor((cellH - 1) / 2);
      const cells = [Text({ key: "label", color: "subtle", children: [mid ? `${rank} ` : "  "] })];
      files.forEach((file, fi) => {
        const sq = `${file}${rank}`;
        const light = (fi + ri) % 2 === 0;
        let bg = light ? LIGHT : DARK;
        if (last.includes(sq)) bg = light ? LAST_LIGHT : LAST_DARK;
        if (sq === props.selected) bg = light ? LIGHT_SEL : DARK_SEL;
        if (state.focused && sq === state.cursor) bg = CURSOR;
        const piece = pieces[sq];
        const art = sprite && piece ? SPRITES[sprite][piece.toLowerCase()] : null;
        let body = " ";
        let fg = piece && piece === piece.toUpperCase() ? WHITE_PIECE : BLACK_PIECE;
        if (mid && piece) body = props.letters ? piece : GLYPH[piece.toLowerCase()] || piece;
        if (dests.has(sq)) {
          if (mid) body = piece ? "×" : "•";
          fg = piece ? CAPTURE : DOT;
        }
        let text = mid ? center(body, cellW) : " ".repeat(cellW);
        if (art) {
          const pad = (cellW - art[line].length) >> 1;
          text = " ".repeat(pad) + art[line] + " ".repeat(cellW - art[line].length - pad);
        }
        cells.push(
          Text({
            key: sq,
            color: fg,
            backgroundColor: bg,
            weight: "bold",
            children: [text],
          }),
        );
      });
      rows.push(Box({ key: `r${rank}-${line}`, flexDirection: "row", children: cells }));
    }
  });

  rows.push(
    Box({
      key: "files",
      flexDirection: "row",
      children: [
        Text({ key: "pad", children: ["  "] }),
        ...files.map((file) => Text({ key: file, color: "subtle", children: [center(file, cellW)] })),
      ],
    }),
  );
  if (props.active) {
    rows.push(
      Text({
        key: "hint",
        dimColor: true,
        children: [
          state.focused ? "arrows move · enter picks · esc leaves the board" : "click a piece, then a square",
        ],
      }),
    );
  }
  return Box({ flexDirection: "column", children: rows });
}

function chessSquareAt(props, columns, x, y) {
  const { files, ranks, cellW, cellH } = chessLayout(props, columns);
  if (x < 2) return null;
  const fi = Math.floor((x - 2) / cellW);
  const ri = Math.floor(y / cellH);
  if (fi < 0 || fi > 7 || ri < 0 || ri > 7) return null;
  return `${files[fi]}${ranks[ri]}`;
}

function moveCursor(props, cursor, key) {
  const flip = props.color === "b";
  const sq = cursor || (flip ? "e7" : "e2");
  let f = "abcdefgh".indexOf(sq[0]);
  let r = Number(sq[1]);
  const step = flip ? -1 : 1;
  if (key === "up") r += step;
  if (key === "down") r -= step;
  if (key === "left") f -= step;
  if (key === "right") f += step;
  f = Math.min(7, Math.max(0, f));
  r = Math.min(8, Math.max(1, r));
  return "abcdefgh"[f] + r;
}

function drawFlappy(props, state, surface) {
  const { Box, Text } = surface.elements;
  const round = state.flappy;
  const game = round && round.game;
  const w = game ? game.w : BOARD_W;
  const h = game ? game.h : BOARD_H;
  const opening = gapSize(h);
  const row = game ? birdRow(game) : Math.floor(h / 2);
  const rows = [];
  for (let y = 0; y < h; y++) {
    const runs = [];
    let run = null;
    for (let x = 0; x < w; x++) {
      let ch = " ";
      let fg = SKY;
      let bg = SKY;
      const pipe = game && game.pipes.find((item) => item.x === x);
      if (pipe && (y < pipe.gap || y >= pipe.gap + opening)) {
        ch = "█";
        fg = PIPE_INK;
        bg = PIPE;
      }
      if (game && x === BIRD_X && y === row) {
        ch = game.over ? "×" : ">";
        fg = BIRD_INK;
        bg = game.over ? CRASH : BIRD;
      }
      if (run && run.ch === ch && run.fg === fg && run.bg === bg) run.n += 1;
      else {
        run = { ch, fg, bg, n: 1 };
        runs.push(run);
      }
    }
    rows.push(
      Box({
        key: `f${y}`,
        flexDirection: "row",
        children: runs.map((item, i) =>
          Text({
            key: String(i),
            color: item.fg,
            backgroundColor: item.bg,
            children: [item.ch.repeat(item.n)],
          }),
        ),
      }),
    );
  }
  let hint = "Prompt to find a player. You each fly the same course. Higher score wins.";
  if (props.status === "playing" && !game) hint = "Same course. Click the board, then space flaps.";
  else if (game && game.over && props.winner === "you") hint = `You win ${props.you} to ${props.them}`;
  else if (game && game.over && props.winner === "them") hint = `${props.themName || "They"} win ${props.them} to ${props.you}`;
  else if (game && game.over && props.winner === "draw") hint = `Draw · ${props.you} each`;
  else if (game && game.over) hint = `You scored ${game.score}. Waiting for ${props.themName || "the other player"}.`;
  else if (game && round && !round.playing) hint = `Paused · ${game.score} · p resumes`;
  else if (game) hint = state.focused ? `Score ${game.score} · space flaps · p pauses` : `Score ${game.score} · click the board, then space flaps`;
  rows.push(Text({ key: "hint", dimColor: true, children: [hint] }));
  return Box({ flexDirection: "column", children: rows });
}

function startFlappy(props) {
  const started = beginRound(Number(props.seed) || 1);
  return {
    contestId: props.contestId,
    game: started.game,
    rng: started.rng,
    playing: true,
    posted: false,
  };
}

export default function Board(props, surface) {
  const p = props || {};
  if (surface.state === undefined) {
    surface.setState({ focused: false, cursor: null, flappy: null });
    surface.every(100, () => {
      const s = surface.state;
      const round = s && s.flappy;
      if (!round || !round.playing || !round.game || round.game.over) return;
      const stepped = stepRound(round.game, round.rng);
      const flappy = { ...round, game: stepped.game, rng: stepped.rng };
      if (stepped.game.over && !round.posted) {
        flappy.posted = true;
        surface.post({ kind: "flappy-score", score: stepped.game.score, contestId: round.contestId });
      }
      surface.setState({ ...s, flappy });
    });
  }
  const state = surface.state || { focused: false, cursor: null, flappy: null };

  if (p.game === "flappy") {
    const fresh =
      p.status === "playing" &&
      p.contestId &&
      (!state.flappy || state.flappy.contestId !== p.contestId);
    if (fresh) {
      surface.setState({ ...state, focused: true, flappy: startFlappy(p) });
    } else if (p.status !== "playing" && state.flappy) {
      surface.setState({ ...state, focused: false, flappy: null });
    }
  } else if (state.flappy) {
    surface.setState({ ...state, flappy: null });
  }

  const live = () => surface.state || { focused: false, cursor: null };

  const flapNow = () => {
    const s = live();
    if (!s.flappy || !s.flappy.game || s.flappy.game.over) return;
    surface.setState({
      ...s,
      focused: true,
      flappy: { ...s.flappy, playing: true, game: flap(s.flappy.game) },
    });
  };

  surface.onPointer((event) => {
    if (event.type !== "down" || event.button !== "left") return;
    const current = live();
    if (p.game === "flappy") {
      flapNow();
      return;
    }
    const sq = chessSquareAt(p, surface.columns, event.x, event.y);
    surface.setState({ focused: true, cursor: sq || current.cursor, flappy: current.flappy });
    if (sq) surface.post({ kind: "square", sq });
  });

  surface.onKey((event) => {
    const key = String(event.key || "").toLowerCase();
    const current = live();
    if (p.game === "flappy") {
      if (key === "p" && current.flappy && !current.flappy.game.over) {
        surface.setState({
          ...current,
          focused: true,
          flappy: { ...current.flappy, playing: !current.flappy.playing },
        });
        return;
      }
      if (key === " " || key === "space" || key === "up" || key === "w" || key === "return") flapNow();
      return;
    }
    if (key === "up" || key === "down" || key === "left" || key === "right") {
      surface.setState({ focused: true, cursor: moveCursor(p, current.cursor, key), flappy: current.flappy });
    } else if ((key === "return" || key === " ") && current.cursor) {
      surface.post({ kind: "square", sq: current.cursor });
    }
  });

  const drawn = live();
  if (p.game === "flappy") return drawFlappy(p, drawn, surface);
  return drawChess(p, drawn, surface);
}
