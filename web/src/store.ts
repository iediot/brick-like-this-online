/**
 * Where the game lives.
 *
 * On this device, and nowhere else. Your pieces, your teams, your score and
 * your play log are held in the browser, so two people opening the same address
 * get two separate games rather than fighting over one. That is the right shape
 * for this: a pile of bricks belongs to whoever is sitting in front of it, and
 * there is nothing here worth putting on somebody else's machine.
 *
 * It also means the site is only files. There is no database to host, no state
 * to keep alive between visits, and the whole thing can sit on static hosting
 * for nothing.
 *
 * localStorage rather than IndexedDB: the entire save is a few dozen pieces,
 * four teams and a short history — kilobytes, read once at startup and written
 * on deliberate actions. An async database would buy nothing but ceremony.
 */

import type { InventoryEntry } from '@shared/inventory.ts';
import type { Team } from '@shared/teams.ts';

/**
 * Versioned, because these keys outlive the code that wrote them. If the shape
 * of what is stored ever has to change incompatibly, the new build reads a new
 * key and finds nothing rather than choking on a save it cannot understand.
 */
const PREFIX = 'brick-like-this/v1';

const KEYS = {
  inventory: `${PREFIX}/inventory`,
  teams: `${PREFIX}/teams`,
  game: `${PREFIX}/game`,
  rounds: `${PREFIX}/rounds`,
} as const;

/**
 * Safari in private browsing, and any browser with site data switched off,
 * either hide localStorage or throw on write. Neither should take the game
 * down: fall back to memory, so the session works from start to finish and only
 * forgets when the tab closes.
 */
const memory = new Map<string, string>();

function backing(): Pick<Storage, 'getItem' | 'setItem'> {
  try {
    const probe = `${PREFIX}/probe`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return {
      getItem: (k) => memory.get(k) ?? null,
      setItem: (k, v) => void memory.set(k, v),
    };
  }
}

const store = backing();

function read<T>(key: string, fallback: T): T {
  try {
    const raw = store.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    // A save from a future version, or one truncated by a tab that died
    // mid-write. Losing it beats refusing to start.
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // Out of quota, or storage revoked mid-session. The value is already in
    // the caller's hands and on screen; dropping the write loses it at the end
    // of the session rather than in the middle of a round.
  }
}

export interface StoredGame {
  /**
   * Allowed to reach TOTAL_ROUNDS + 1, which is how a finished game stays
   * finished across a reload. Callers clamp it for display.
   */
  round: number;
  activeTeam: number;
}

export interface StoredRound {
  id: string;
  cardId: string;
  brickCount: number;
  coverage: number;
  overflow: number;
  points: number;
  playedAt: string;
}

/** Long enough to look back over an evening, short enough never to matter. */
const ROUND_HISTORY = 50;

export const local = {
  inventory: (): InventoryEntry[] => read<InventoryEntry[]>(KEYS.inventory, []),
  setInventory: (entries: InventoryEntry[]) => write(KEYS.inventory, entries),

  teams: (): Team[] => read<Team[]>(KEYS.teams, []),
  setTeams: (teams: Team[]) => write(KEYS.teams, teams),

  game: (): StoredGame => read<StoredGame>(KEYS.game, { round: 1, activeTeam: 0 }),
  setGame: (game: StoredGame) => write(KEYS.game, game),

  rounds: (): StoredRound[] => read<StoredRound[]>(KEYS.rounds, []),
  addRound: (round: StoredRound) => {
    const kept = [round, ...local.rounds()].slice(0, ROUND_HISTORY);
    write(KEYS.rounds, kept);
  },
};
