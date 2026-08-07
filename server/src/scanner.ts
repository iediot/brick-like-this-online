/**
 * Pile scanning against a local vision model.
 *
 * This is the one job in the project where a model is genuinely irreducible.
 * Silhouette generation is procedural, scoring is a mask comparison — but
 * there is no algorithm that looks at a heap of bricks and knows what is in
 * it. That is perception, and the only alternative is typing counts by hand.
 *
 * Everything runs on this machine through Ollama. No network, no account, no
 * expiry. If the model is unavailable the app falls back to manual entry
 * rather than breaking, because the scanner is a convenience over a form that
 * already works.
 */

import { spawn } from 'node:child_process';
import { CATALOGUE, PIECE_BY_ID, type InventoryEntry } from '../../shared/inventory.ts';

const OLLAMA = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
export const SCAN_MODEL = process.env.SCAN_MODEL ?? 'qwen2.5vl:7b';

/**
 * Counting many small objects is a known weak spot for vision models, so the
 * prompt asks for grouped estimates against a fixed list rather than an open
 * tally. Constraining it to catalogue IDs also means nothing has to be guessed
 * back into our vocabulary afterwards.
 */
const PROMPT = `You are looking at a photo of loose LEGO-style pieces spread on a surface.

Estimate how many of each piece type are present. Only use these piece types:

${CATALOGUE.map((p) => `- ${p.id}: ${p.label}`).join('\n')}

Rules:
- Approximate counts are expected and fine. Do not attempt an exact tally.
- Ignore colour entirely. It does not matter.
- Only report piece types you can actually see. Omit the rest.
- If a piece's exact size is unclear, choose the closest one in the list.
- If you cannot see any pieces, return an empty list.`;

const SCHEMA = {
  type: 'object',
  properties: {
    pieces: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          pieceId: { type: 'string', enum: CATALOGUE.map((p) => p.id) },
          count: { type: 'integer' },
        },
        required: ['pieceId', 'count'],
      },
    },
  },
  required: ['pieces'],
};

export interface ScannerStatus {
  running: boolean;
  modelReady: boolean;
  model: string;
  detail?: string;
}

export async function status(): Promise<ScannerStatus> {
  try {
    const res = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return { running: false, modelReady: false, model: SCAN_MODEL };

    const body = (await res.json()) as { models?: Array<{ name: string }> };
    const names = body.models?.map((m) => m.name) ?? [];
    // Ollama reports "qwen2.5vl:7b"; tolerate a bare name without the tag.
    const modelReady = names.some((n) => n === SCAN_MODEL || n.startsWith(`${SCAN_MODEL}:`));

    return {
      running: true,
      modelReady,
      model: SCAN_MODEL,
      detail: modelReady ? undefined : `Model not pulled. Run: ollama pull ${SCAN_MODEL}`,
    };
  } catch {
    return {
      running: false,
      modelReady: false,
      model: SCAN_MODEL,
      detail: 'Ollama is not responding.',
    };
  }
}

/**
 * Start Ollama if it is not already up, so the model comes alive with the app
 * rather than needing a separate terminal. Detached and unref'd: a serve
 * process that outlives us is fine and is reused on the next start.
 */
export async function ensureRunning(): Promise<ScannerStatus> {
  const current = await status();
  if (current.running) return current;

  try {
    spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    return { running: false, modelReady: false, model: SCAN_MODEL, detail: 'ollama not installed' };
  }

  // Give it a moment to bind, then re-check rather than assuming success.
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const next = await status();
    if (next.running) return next;
  }
  return { running: false, modelReady: false, model: SCAN_MODEL, detail: 'Ollama did not start.' };
}

/** Strip a data: URL prefix if present — Ollama wants bare base64. */
function toBareBase64(image: string): string {
  const comma = image.indexOf(',');
  return image.startsWith('data:') && comma !== -1 ? image.slice(comma + 1) : image;
}

export async function scanPile(image: string): Promise<InventoryEntry[]> {
  const state = await status();
  if (!state.running) throw new Error(state.detail ?? 'Ollama is not running.');
  if (!state.modelReady) throw new Error(state.detail ?? 'Model not available.');

  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: SCAN_MODEL,
      stream: false,
      format: SCHEMA,
      options: { temperature: 0.1 },
      messages: [{ role: 'user', content: PROMPT, images: [toBareBase64(image)] }],
    }),
    // Vision inference on a 7B model takes a while on first load.
    signal: AbortSignal.timeout(180_000),
  });

  if (!res.ok) throw new Error(`Model request failed: ${res.status} ${await res.text()}`);

  const body = (await res.json()) as { message?: { content?: string } };
  const raw = body.message?.content;
  if (!raw) throw new Error('Model returned nothing.');

  let parsed: { pieces?: unknown };
  try {
    parsed = JSON.parse(raw) as { pieces?: unknown };
  } catch {
    throw new Error(`Model returned unparseable output: ${raw.slice(0, 200)}`);
  }

  return normalize(parsed.pieces);
}

/**
 * Clamp the model's output into something sane. A vision model will
 * occasionally claim 4000 of a piece, and a wild number silently wrecks every
 * model generated afterwards.
 */
function normalize(pieces: unknown): InventoryEntry[] {
  if (!Array.isArray(pieces)) return [];

  const merged = new Map<string, number>();
  for (const raw of pieces) {
    const p = raw as Record<string, unknown>;
    const pieceId = String(p.pieceId);
    if (!PIECE_BY_ID.has(pieceId)) continue;

    const count = Math.round(Number(p.count));
    if (!Number.isFinite(count) || count <= 0) continue;
    // The model sometimes lists the same piece twice; add rather than replace.
    merged.set(pieceId, Math.min(500, (merged.get(pieceId) ?? 0) + count));
  }

  return [...merged].map(([pieceId, count]) => ({ pieceId, count }));
}
