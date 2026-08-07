import { useMemo, useState } from 'react';
import {
  CATALOGUE,
  FAMILY_LABELS,
  type InventoryEntry,
  type PieceFamily,
  type PieceType,
} from '@shared/inventory.ts';
import { layout, piecePath, type PlacedPiece } from '@shared/card.ts';
import { api, type InventoryState } from './api.ts';
import { PileScanner } from './PileScanner.tsx';

/**
 * Every piece is drawn on the same grid rather than scaled to its own box.
 * Otherwise a 1x1 and a 1x8 render at identical size and the picture stops
 * telling you anything — the whole reason for showing the shape instead of the
 * name is that you can match it against the piece in your hand.
 */
const ICON_GRID = { studs: 8, plates: 8 };
/** Wide, so a 1x8 brick fills the row rather than shrinking to fit. */
const ICON_BOX = { w: 80, h: 42 };

export function Inventory({
  state,
  onChange,
}: {
  state: InventoryState;
  onChange: (s: InventoryState) => void;
}) {
  const [counts, setCounts] = useState<Map<string, number>>(
    () => new Map(state.entries.map((e) => [e.pieceId, e.count])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justScanned, setScanned] = useState(false);

  const saved = useMemo(
    () => new Map(state.entries.map((e) => [e.pieceId, e.count])),
    [state.entries],
  );

  const dirty = useMemo(() => {
    const ids = new Set([...counts.keys(), ...saved.keys()]);
    for (const id of ids) {
      if ((counts.get(id) ?? 0) !== (saved.get(id) ?? 0)) return true;
    }
    return false;
  }, [counts, saved]);

  const set = (id: string, n: number) =>
    setCounts((prev) => {
      const next = new Map(prev);
      if (n <= 0) next.delete(id);
      else next.set(id, Math.min(999, n));
      return next;
    });

  const save = async () => {
    setSaving(true);
    setError(null);
    const entries: InventoryEntry[] = [...counts]
      .filter(([, n]) => n > 0)
      .map(([pieceId, count]) => ({ pieceId, count }));
    try {
      onChange(await api.saveInventory(entries));
      setScanned(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const families = [...new Set(CATALOGUE.map((p) => p.family))] as PieceFamily[];
  const total = [...counts.values()].reduce((a, b) => a + b, 0);

  return (
    <div className="panel">
      {justScanned ? (
        <p className="muted scanned-note">Scanned — check the numbers before saving.</p>
      ) : null}

      <div className="families">
        {families.map((family) => (
          <section key={family} className="family">
            <h3>{FAMILY_LABELS[family]}</h3>
            <div className="piece-grid">
              {CATALOGUE.filter((p) => p.family === family).map((piece) => (
                <PieceTile
                  key={piece.id}
                  piece={piece}
                  count={counts.get(piece.id) ?? 0}
                  onSet={(n) => set(piece.id, n)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="save-bar">
        <span className="muted">{total} pieces</span>
        <div className="save-actions">
          <PileScanner
            onResult={(scanned) => {
              setCounts(new Map(scanned.map((e) => [e.pieceId, e.count])));
              setScanned(true);
            }}
          />
          <button className="primary" onClick={() => void save()} disabled={!dirty || saving}>
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}

/** The piece's drawing, with its count directly underneath. No name. */
function PieceTile({
  piece,
  count,
  onSet,
}: {
  piece: PieceType;
  count: number;
  onSet: (n: number) => void;
}) {
  // Centred in the shared grid rather than parked at its bottom-left corner.
  const placed: PlacedPiece = {
    pieceId: piece.id,
    family: piece.family,
    x: (ICON_GRID.studs - piece.studs) / 2,
    y: (ICON_GRID.plates - piece.plates) / 2,
    studs: piece.studs,
    plates: piece.plates,
    flipped: false,
  };
  const l = layout(ICON_GRID, ICON_BOX);

  return (
    <div className={`piece-tile${count > 0 ? ' has' : ''}`} title={piece.label}>
      <svg viewBox={`0 0 ${ICON_BOX.w} ${ICON_BOX.h}`} className="piece-icon">
        <path d={piecePath(placed, [placed], l)} />
      </svg>
      <div className="stepper">
        <button onClick={() => onSet(count - 1)} disabled={count === 0} aria-label="One fewer">
          −
        </button>
        <input
          type="number"
          min={0}
          value={count}
          aria-label={piece.label}
          onChange={(e) => onSet(Math.max(0, Number(e.target.value)))}
        />
        <button onClick={() => onSet(count + 1)} aria-label="One more">
          +
        </button>
      </div>
    </div>
  );
}
