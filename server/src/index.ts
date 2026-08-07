import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { summarize, PIECE_BY_ID, type InventoryEntry } from '../../shared/inventory.ts';
import { generateCard, type PieceCount } from '../../shared/card.ts';
import { MAX_PLAYERS, MAX_TEAMS, type Team } from '../../shared/teams.ts';
import { TOTAL_ROUNDS, advance, type GameState } from '../../shared/game.ts';
import {
  listInventory,
  replaceInventory,
  recordRound,
  listRounds,
  listTeams,
  replaceTeams,
  readGame,
  writeGame,
} from './db.ts';
import { ensureRunning, scanPile, status as scannerStatus } from './scanner.ts';

const PORT = Number(process.env.PORT ?? 8787);
const WEB_DIST = resolve(import.meta.dirname, '../../web/dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  // Without this a PDF is served as octet-stream, which browsers download
  // rather than render — so the embedded rulebook shows as a blank frame.
  '.pdf': 'application/pdf',
};

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Reject anything that is not a known catalogue piece rather than trusting the client. */
function parseEntries(input: unknown): InventoryEntry[] {
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

/** Reject anything that is not a plausible team rather than trusting the client. */
function parseTeams(input: unknown): Team[] {
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
      id: String(t.id ?? randomUUID()),
      name: name.slice(0, 40),
      players,
      roundsPlayed: Math.max(0, Math.round(Number(t.roundsPlayed ?? 0))),
      score: Math.max(0, Math.round(Number(t.score ?? 0))),
    };
  });
}

function currentGame(): GameState {
  const { round, activeTeam } = readGame();
  const teams = listTeams();
  return {
    round: Math.min(round, TOTAL_ROUNDS),
    // A team may have been removed since the turn was recorded.
    activeTeam: teams.length > 0 ? activeTeam % teams.length : 0,
    teams,
    finished: round > TOTAL_ROUNDS,
  };
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const route = `${req.method} ${url.pathname}`;

  switch (route) {
    case 'GET /api/health':
      json(res, 200, { ok: true });
      return true;

    case 'GET /api/inventory': {
      const entries = listInventory();
      json(res, 200, { entries, summary: summarize(entries) });
      return true;
    }

    case 'PUT /api/inventory': {
      const body = (await readJson(req)) as { entries?: unknown };
      const entries = parseEntries(body?.entries);
      replaceInventory(entries);
      json(res, 200, { entries, summary: summarize(entries) });
      return true;
    }

    case 'POST /api/cards/draw': {
      const body = ((await readJson(req)) ?? {}) as { count?: number; seed?: string };
      const entries = listInventory();
      if (entries.length === 0) {
        json(res, 409, { error: 'Inventory is empty — add some bricks first.' });
        return true;
      }
      const count =
        body.count && body.count >= 5 && body.count <= 8
          ? (body.count as PieceCount)
          : undefined;
      json(res, 200, generateCard(entries, { count, seed: body.seed }));
      return true;
    }

    case 'GET /api/teams':
      json(res, 200, { teams: listTeams() });
      return true;

    case 'PUT /api/teams': {
      const body = (await readJson(req)) as { teams?: unknown };
      const teams = parseTeams(body?.teams);
      replaceTeams(teams);
      // A roster is only ever saved at setup, so this is the start of a game.
      // Inheriting the previous turn would have the wrong team up first.
      writeGame(1, 0);
      json(res, 200, { teams });
      return true;
    }

    case 'GET /api/game':
      json(res, 200, currentGame());
      return true;

    case 'POST /api/game/turn': {
      const body = ((await readJson(req)) ?? {}) as { points?: number };
      const game = currentGame();
      if (game.teams.length === 0) {
        json(res, 409, { error: 'No teams yet.' });
        return true;
      }

      const points = Math.max(0, Math.round(Number(body.points ?? 0)));
      const scored = {
        ...game,
        teams: game.teams.map((t, i) =>
          i === game.activeTeam ? { ...t, score: t.score + points } : t,
        ),
      };

      const next = advance(scored);
      replaceTeams(next.teams);
      writeGame(next.finished ? TOTAL_ROUNDS + 1 : next.round, next.activeTeam);
      json(res, 200, currentGame());
      return true;
    }

    case 'POST /api/game/restart': {
      // Clears the roster as well as the score — a new game, not a rematch.
      replaceTeams([]);
      writeGame(1, 0);
      json(res, 200, currentGame());
      return true;
    }

    case 'POST /api/game/reset': {
      const teams = listTeams().map((t) => ({ ...t, roundsPlayed: 0, score: 0 }));
      replaceTeams(teams);
      writeGame(1, 0);
      json(res, 200, currentGame());
      return true;
    }

    case 'GET /api/scan/status':
      json(res, 200, await scannerStatus());
      return true;

    case 'POST /api/scan': {
      const body = (await readJson(req)) as { image?: string };
      if (!body?.image) {
        json(res, 400, { error: 'No image supplied.' });
        return true;
      }
      try {
        json(res, 200, { entries: await scanPile(body.image) });
      } catch (err) {
        // A scanner failure must not look like an app failure — the form
        // still works, so say what went wrong and let the player type.
        json(res, 503, {
          error: err instanceof Error ? err.message : 'Scan failed.',
          fallback: 'You can still add bricks by hand.',
        });
      }
      return true;
    }

    case 'GET /api/rounds':
      json(res, 200, { rounds: listRounds() });
      return true;

    case 'POST /api/rounds': {
      const b = (await readJson(req)) as Record<string, unknown>;
      const record = {
        id: randomUUID(),
        cardId: String(b.cardId ?? ''),
        brickCount: Number(b.brickCount ?? 0),
        coverage: Number(b.coverage ?? 0),
        overflow: Number(b.overflow ?? 0),
        points: Number(b.points ?? 0),
        playedAt: new Date().toISOString(),
      };
      recordRound(record);
      json(res, 201, record);
      return true;
    }
  }

  return false;
}

/** Serve the built web app. Unknown paths fall through to index.html for the SPA. */
async function serveStatic(url: URL, res: ServerResponse): Promise<void> {
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  // normalize() collapses "..", so a traversal attempt lands outside WEB_DIST
  // and fails the prefix check below rather than escaping it.
  const candidate = resolve(join(WEB_DIST, normalize(requested)));

  const target = candidate.startsWith(WEB_DIST) ? candidate : join(WEB_DIST, 'index.html');

  try {
    const body = await readFile(target);
    res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    try {
      const fallback = await readFile(join(WEB_DIST, 'index.html'));
      res.writeHead(200, { 'content-type': MIME['.html'] });
      res.end(fallback);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found. Run `npm run build` in web/ first.');
    }
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  void (async () => {
    try {
      if (url.pathname.startsWith('/api/')) {
        const handled = await handleApi(req, res, url);
        if (!handled) json(res, 404, { error: `No route for ${req.method} ${url.pathname}` });
        return;
      }
      await serveStatic(url, res);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      json(res, 400, { error: message });
    }
  })();
});

server.listen(PORT, () => {
  console.log(`brick-like-this server on http://localhost:${PORT}`);

  // Bring the vision model up alongside the app. Deliberately not awaited:
  // the game is fully playable without it, so a slow or failed model start
  // must never delay the server accepting requests.
  void ensureRunning().then((s) => {
    if (s.running && s.modelReady) console.log(`scanner ready (${s.model})`);
    else console.log(`scanner unavailable — manual entry only. ${s.detail ?? ''}`);
  });
});
