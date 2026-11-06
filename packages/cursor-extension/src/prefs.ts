import * as vscode from "vscode";

export const GAME_IDS = ["chess", "sudoku", "maths"] as const;
export type GameId = (typeof GAME_IDS)[number];

export interface SessionPrefs {
  onboarded: boolean;
  games: GameId[];
  multiplayer: boolean;
}

export class PrefsStore {
  private listeners = new Set<(prefs: SessionPrefs) => void>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  get(): SessionPrefs {
    return normalize(this.context.globalState.get<Partial<SessionPrefs>>("session.prefs"));
  }

  async update(next: Partial<SessionPrefs>): Promise<SessionPrefs> {
    const prefs = normalize({ ...this.get(), ...next, onboarded: true });
    await this.context.globalState.update("session.prefs", prefs);
    for (const fn of this.listeners) fn(prefs);
    return prefs;
  }

  onChange(fn: (prefs: SessionPrefs) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

function normalize(raw: Partial<SessionPrefs> | undefined): SessionPrefs {
  const picked = (raw?.games ?? ["chess"]).filter((game): game is GameId =>
    (GAME_IDS as readonly string[]).includes(game),
  );
  const games = [...new Set(picked)];
  const multiplayer = raw?.multiplayer !== false;
  if (multiplayer && !games.includes("chess")) games.unshift("chess");
  if (games.length === 0) games.push("chess");
  return {
    onboarded: Boolean(raw?.onboarded),
    games,
    multiplayer,
  };
}
