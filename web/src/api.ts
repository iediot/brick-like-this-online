/**
 * What the screens call to get things done.
 *
 * This was a set of HTTP routes and is now mostly local work: the game is kept
 * in this browser (see store.ts) and the rules that move it along live in
 * shared/, which is plain TypeScript with nothing Node-only in it, so dealing a
 * card and passing a turn both run here.
 *
 * The shape stayed async even though almost none of it waits for anything. The
 * one call that genuinely does is the scanner, which still has to reach a
 * machine running the vision model — and a mixed set of methods, some to await
 * and some not, is a trap to use. Every screen already awaits these.
 */

import { summarize, type CapabilitySummary, type InventoryEntry } from '@shared/inventory.ts';
import { generateCard, type Card, type PieceCount } from '@shared/card.ts';
import type { Team } from '@shared/teams.ts';
import { TOTAL_ROUNDS, advance, type GameState } from '@shared/game.ts';
import { parseEntries, parseTeams } from '@shared/validate.ts';
import { newId } from '@shared/ids.ts';
import { local } from './store.ts';

export interface InventoryState {
  entries: InventoryEntry[];
  summary: CapabilitySummary;
}

export interface ScannerStatus {
  running: boolean;
  modelReady: boolean;
  model: string;
  detail?: string;
}

/**
 * The stored round counter is allowed to run one past the end — that is what
 * makes a finished game still finished after a reload — so reading it back
 * clamps for display and turns the overflow into the flag instead.
 */
function currentGame(): GameState {
  const { round, activeTeam } = local.game();
  const teams = local.teams();
  return {
    round: Math.min(round, TOTAL_ROUNDS),
    // A team may have been removed since the turn was recorded.
    activeTeam: teams.length > 0 ? activeTeam % teams.length : 0,
    teams,
    finished: round > TOTAL_ROUNDS,
  };
}

/** Still a real request: the vision model runs on a machine, not in a tab. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getInventory: async (): Promise<InventoryState> => {
    const entries = local.inventory();
    return { entries, summary: summarize(entries) };
  },

  saveInventory: async (entries: InventoryEntry[]): Promise<InventoryState> => {
    const clean = parseEntries(entries);
    local.setInventory(clean);
    return { entries: clean, summary: summarize(clean) };
  },

  getGame: async (): Promise<GameState> => currentGame(),

  getTeams: async (): Promise<{ teams: Team[] }> => ({ teams: local.teams() }),

  saveTeams: async (teams: Team[]): Promise<{ teams: Team[] }> => {
    const clean = parseTeams(teams);
    local.setTeams(clean);
    // A roster is only ever saved at setup, so this is the start of a game.
    // Inheriting the previous turn would have the wrong team up first.
    local.setGame({ round: 1, activeTeam: 0 });
    return { teams: clean };
  },

  /** Score the active team's round and pass the turn on. */
  finishTurn: async (points: number): Promise<GameState> => {
    const game = currentGame();
    if (game.teams.length === 0) throw new Error('No teams yet.');

    const gained = Math.max(0, Math.round(Number(points) || 0));
    const scored: GameState = {
      ...game,
      teams: game.teams.map((t, i) =>
        i === game.activeTeam ? { ...t, score: t.score + gained } : t,
      ),
    };

    const next = advance(scored);
    local.setTeams(next.teams);
    local.setGame({
      round: next.finished ? TOTAL_ROUNDS + 1 : next.round,
      activeTeam: next.activeTeam,
    });
    return currentGame();
  },

  /** Same teams, scores back to nothing. */
  resetGame: async (): Promise<GameState> => {
    local.setTeams(local.teams().map((t) => ({ ...t, roundsPlayed: 0, score: 0 })));
    local.setGame({ round: 1, activeTeam: 0 });
    return currentGame();
  },

  /** Clears the teams too, sending you back to setup — a new game, not a rematch. */
  restartGame: async (): Promise<GameState> => {
    local.setTeams([]);
    local.setGame({ round: 1, activeTeam: 0 });
    return currentGame();
  },

  drawCard: async (count?: number): Promise<Card> => {
    const entries = local.inventory();
    if (entries.length === 0) throw new Error('Inventory is empty — add some bricks first.');
    const wanted = count && count >= 5 && count <= 8 ? (count as PieceCount) : undefined;
    return generateCard(entries, { count: wanted });
  },

  saveRound: async (r: {
    cardId: string;
    brickCount: number;
    coverage: number;
    overflow: number;
    points: number;
  }): Promise<void> => {
    local.addRound({ ...r, id: newId(), playedAt: new Date().toISOString() });
  },

  /**
   * Whether a pile can be scanned, which needs the local server and Ollama
   * behind it. Deployed as a static site there is no server at all, and asking
   * for a JSON route gets the app's own HTML back — so a failure here is not an
   * error to report but the ordinary answer that there is no scanner, which
   * leaves the player typing their pieces in by hand.
   */
  scanStatus: async (): Promise<ScannerStatus> => {
    try {
      return await request<ScannerStatus>('/api/scan/status');
    } catch {
      return {
        running: false,
        modelReady: false,
        model: '',
        detail: 'It needs the app running on your own machine, with Ollama.',
      };
    }
  },

  scanPile: (image: string) =>
    request<{ entries: InventoryEntry[] }>('/api/scan', {
      method: 'POST',
      body: JSON.stringify({ image }),
    }),
};
