/**
 * Turning loose input into game data, or refusing it.
 *
 * These once guarded the server, where the rule was never to trust the client.
 * The game is kept in the browser now, so there is no longer a boundary to
 * defend — but the checks earn their place twice over anyway. Stored data
 * outlives the code that wrote it: anything held in a browser can come back a
 * version later, hand-edited, or half-written by a tab that was closed mid-save.
 * And the messages are what the setup screen shows you when a roster is not
 * ready yet, so this is the wording of the errors as much as the logic.
 */

import { PIECE_BY_ID, type InventoryEntry } from './inventory.ts';
import { MAX_PLAYERS, MAX_TEAMS, type Team } from './teams.ts';
import { newId } from './ids.ts';

/** Keep only real catalogue pieces, with counts that make sense. */
export function parseEntries(input: unknown): InventoryEntry[] {
  if (!Array.isArray(input)) throw new Error('expected an array of entries');

  const out: InventoryEntry[] = [];
  for (const [i, raw] of input.entries()) {
    const e = raw as Partial<InventoryEntry>;
    const pieceId = String(e.pieceId ?? '');
    if (!PIECE_BY_ID.has(pieceId)) throw new Error(`entry ${i}: unknown piece "${pieceId}"`);

    const count = Number(e.count);
    if (!Number.isFinite(count) || count < 0) throw new Error(`entry ${i}: bad count`);
    if (count > 0) out.push({ pieceId, count: Math.min(999, Math.round(count)) });
  }
  return out;
}

/** Keep only teams that could actually take a turn. */
export function parseTeams(input: unknown): Team[] {
  if (!Array.isArray(input)) throw new Error('expected an array of teams');
  if (input.length > MAX_TEAMS) throw new Error(`at most ${MAX_TEAMS} teams`);

  return input.map((raw, i) => {
    const t = raw as Partial<Team>;
    const name = String(t.name ?? '').trim();
    if (!name) throw new Error(`team ${i + 1}: needs a name`);

    const players = (Array.isArray(t.players) ? t.players : [])
      .map((p) => String(p).trim())
      .filter(Boolean)
      .slice(0, MAX_PLAYERS);
    if (players.length < 2) throw new Error(`team ${i + 1}: needs at least two players`);

    return {
      id: String(t.id ?? newId()),
      name: name.slice(0, 40),
      players,
      roundsPlayed: Math.max(0, Math.round(Number(t.roundsPlayed ?? 0))),
      score: Math.max(0, Math.round(Number(t.score ?? 0))),
    };
  });
}
