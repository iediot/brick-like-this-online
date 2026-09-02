/**
 * The local server.
 *
 * It does two things: hand over the built web app, and put a pile of bricks in
 * front of the vision model. It holds no game state at all — your pieces,
 * teams and score live in your own browser, so two people can open the same
 * address and play separate games, and the site itself is just files.
 *
 * That leaves scanning as the only reason this exists. It needs Ollama on the
 * same machine, which is why the app degrades to typing pieces in by hand when
 * it is served from anywhere else.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

import { ensureRunning, scanPile, status as scannerStatus } from './scanner.ts';

const PORT = Number(process.env.PORT ?? 8787);
const WEB_DIST = resolve(import.meta.dirname, '../../web/dist');
/* The build nests its output so the folder layout matches the URL the app is
   served from. Everything under WEB_DIST is still served by path, so only the
   fallback has to know where the app's own index actually sits. */
const APP_INDEX = join(WEB_DIST, 'brick-like-this-online', 'index.html');

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

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  switch (`${req.method} ${url.pathname}`) {
    case 'GET /api/health':
      json(res, 200, { ok: true });
      return true;

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
  }

  return false;
}

/** Serve the built web app. Unknown paths fall through to index.html for the SPA. */
async function serveStatic(url: URL, res: ServerResponse): Promise<void> {
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  // normalize() collapses "..", so a traversal attempt lands outside WEB_DIST
  // and fails the prefix check below rather than escaping it.
  const candidate = resolve(join(WEB_DIST, normalize(requested)));

  const target = candidate.startsWith(WEB_DIST) ? candidate : APP_INDEX;

  try {
    const body = await readFile(target);
    res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    try {
      const fallback = await readFile(APP_INDEX);
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
