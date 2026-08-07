import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { InventoryEntry } from '../../shared/inventory.ts';
import type { Team } from '../../shared/teams.ts';

const DB_PATH = resolve(import.meta.dirname, '../../data/game.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS inventory (
    piece_id TEXT PRIMARY KEY,
    count    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS teams (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    -- Player names as a JSON array: a team is two people, always read and
    -- written whole, so a second table would buy nothing.
    players       TEXT NOT NULL,
    position      INTEGER NOT NULL,
    rounds_played INTEGER NOT NULL DEFAULT 0,
    score         INTEGER NOT NULL DEFAULT 0
  );

  -- One row, holding whose turn it is. A table rather than a file so it lives
  -- and dies with the rest of the game state.
  CREATE TABLE IF NOT EXISTS game (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    round       INTEGER NOT NULL,
    active_team INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rounds (
    id          TEXT PRIMARY KEY,
    card_id     TEXT NOT NULL,
    brick_count INTEGER NOT NULL,
    coverage    REAL NOT NULL,
    overflow    REAL NOT NULL,
    points      INTEGER NOT NULL,
    played_at   TEXT NOT NULL
  );
`);

/**
 * Rebuild a table whose shape has changed since it was created.
 *
 * Both tables were redefined when pieces stopped being (shape, width, length)
 * triples and became catalogue entries. These hold a short inventory and a
 * play log, so dropping beats writing a migration for data that takes a minute
 * to re-enter.
 */
function rebuildIfStale(table: string, requiredColumn: string, ddl: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.length > 0 && !columns.some((c) => c.name === requiredColumn)) {
    db.exec(`DROP TABLE ${table}`);
    db.exec(ddl);
  }
}

rebuildIfStale(
  'teams',
  'rounds_played',
  `CREATE TABLE teams (
     id            TEXT PRIMARY KEY,
     name          TEXT NOT NULL,
     players       TEXT NOT NULL,
     position      INTEGER NOT NULL,
     rounds_played INTEGER NOT NULL DEFAULT 0,
     score         INTEGER NOT NULL DEFAULT 0
   )`,
);

db.prepare('INSERT OR IGNORE INTO game (id, round, active_team) VALUES (1, 1, 0)').run();

rebuildIfStale(
  'inventory',
  'piece_id',
  'CREATE TABLE inventory (piece_id TEXT PRIMARY KEY, count INTEGER NOT NULL)',
);

rebuildIfStale(
  'rounds',
  'brick_count',
  `CREATE TABLE rounds (
     id          TEXT PRIMARY KEY,
     card_id     TEXT NOT NULL,
     brick_count INTEGER NOT NULL,
     coverage    REAL NOT NULL,
     overflow    REAL NOT NULL,
     points      INTEGER NOT NULL,
     played_at   TEXT NOT NULL
   )`,
);

export function listInventory(): InventoryEntry[] {
  const rows = db.prepare('SELECT * FROM inventory ORDER BY piece_id').all() as Array<
    Record<string, unknown>
  >;
  return rows.map((r) => ({ pieceId: String(r.piece_id), count: Number(r.count) }));
}

/** Replace the whole inventory. The UI edits a list, so it saves a list. */
export function replaceInventory(entries: InventoryEntry[]): void {
  const clear = db.prepare('DELETE FROM inventory');
  const insert = db.prepare('INSERT INTO inventory (piece_id, count) VALUES (?, ?)');
  db.exec('BEGIN');
  try {
    clear.run();
    for (const e of entries) insert.run(e.pieceId, e.count);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function listTeams(): Team[] {
  const rows = db.prepare('SELECT * FROM teams ORDER BY position').all() as Array<
    Record<string, unknown>
  >;
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    players: JSON.parse(String(r.players)) as string[],
    roundsPlayed: Number(r.rounds_played ?? 0),
    score: Number(r.score ?? 0),
  }));
}

export function readGame(): { round: number; activeTeam: number } {
  const row = db.prepare('SELECT round, active_team FROM game WHERE id = 1').get() as
    | Record<string, unknown>
    | undefined;
  return { round: Number(row?.round ?? 1), activeTeam: Number(row?.active_team ?? 0) };
}

export function writeGame(round: number, activeTeam: number): void {
  db.prepare('UPDATE game SET round = ?, active_team = ? WHERE id = 1').run(round, activeTeam);
}

export function replaceTeams(teams: Team[]): void {
  const clear = db.prepare('DELETE FROM teams');
  const insert = db.prepare(
    'INSERT INTO teams (id, name, players, position, rounds_played, score) VALUES (?, ?, ?, ?, ?, ?)',
  );
  db.exec('BEGIN');
  try {
    clear.run();
    teams.forEach((t, i) =>
      insert.run(t.id, t.name, JSON.stringify(t.players), i, t.roundsPlayed, t.score),
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export interface RoundRecord {
  id: string;
  cardId: string;
  brickCount: number;
  coverage: number;
  overflow: number;
  points: number;
  playedAt: string;
}

export function recordRound(r: RoundRecord): void {
  db.prepare(
    `INSERT INTO rounds (id, card_id, brick_count, coverage, overflow, points, played_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(r.id, r.cardId, r.brickCount, r.coverage, r.overflow, r.points, r.playedAt);
}

export function listRounds(limit = 50): RoundRecord[] {
  const rows = db
    .prepare('SELECT * FROM rounds ORDER BY played_at DESC LIMIT ?')
    .all(limit) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    cardId: String(r.card_id),
    brickCount: Number(r.brick_count),
    coverage: Number(r.coverage),
    overflow: Number(r.overflow),
    points: Number(r.points),
    playedAt: String(r.played_at),
  }));
}
