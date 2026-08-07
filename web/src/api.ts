import type { CapabilitySummary, InventoryEntry } from '@shared/inventory.ts';
import type { Card } from '@shared/card.ts';
import type { Team } from '@shared/teams.ts';
import type { GameState } from '@shared/game.ts';

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

export const api = {
  getInventory: () => request<InventoryState>('/api/inventory'),

  getGame: () => request<GameState>('/api/game'),

  /** Score the active team's round and pass the turn on. */
  finishTurn: (points: number) =>
    request<GameState>('/api/game/turn', { method: 'POST', body: JSON.stringify({ points }) }),

  resetGame: () => request<GameState>('/api/game/reset', { method: 'POST' }),

  /** Clears the teams too, sending you back to setup. */
  restartGame: () => request<GameState>('/api/game/restart', { method: 'POST' }),

  getTeams: () => request<{ teams: Team[] }>('/api/teams'),

  saveTeams: (teams: Team[]) =>
    request<{ teams: Team[] }>('/api/teams', {
      method: 'PUT',
      body: JSON.stringify({ teams }),
    }),

  scanStatus: () => request<ScannerStatus>('/api/scan/status'),

  scanPile: (image: string) =>
    request<{ entries: InventoryEntry[] }>('/api/scan', {
      method: 'POST',
      body: JSON.stringify({ image }),
    }),

  saveInventory: (entries: InventoryEntry[]) =>
    request<InventoryState>('/api/inventory', {
      method: 'PUT',
      body: JSON.stringify({ entries }),
    }),

  drawCard: (count?: number) =>
    request<Card>('/api/cards/draw', {
      method: 'POST',
      body: JSON.stringify({ count }),
    }),

  saveRound: (r: {
    cardId: string;
    brickCount: number;
    coverage: number;
    overflow: number;
    points: number;
  }) => request<unknown>('/api/rounds', { method: 'POST', body: JSON.stringify(r) }),
};
