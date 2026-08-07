import type { MouseEvent, Ref } from 'react';
import { CARD_H, CARD_W, layout, piecePath, type Card } from '@shared/card.ts';

/**
 * The model as printed on a shape card.
 *
 * Every piece is filled in the same ink and they sit flush against each other,
 * so they read as one silhouette — which is how the printed cards look.
 *
 * The exception is the 5 card. In the real game the easiest cards divide the
 * shape into its individual bricks to help newer players, while the harder
 * ones show only an outline. Drawing the seams here is the same hint.
 *
 * With `cutout` the same card is drawn inside out: the tier colour fills the
 * face and the model is punched through it, so a camera behind shows only
 * where the build belongs. Deliberately the same component in the same place —
 * turning the camera on should open a window in the card you are already
 * looking at, not swap it for a different thing.
 */
export function ModelFigure({ card, cutout = false }: { card: Card; cutout?: boolean }) {
  const l = layout(card.grid);
  const showSeams = card.count === 5;
  const paths = card.pieces.map((piece) => piecePath(piece, card.pieces, l));
  const merged = paths.join(' ');

  if (cutout) {
    const maskId = `cut-${card.id}`;
    return (
      <svg viewBox={`0 0 ${CARD_W} ${CARD_H}`} className="model cutout">
        <defs>
          <mask id={maskId}>
            {/* White keeps the card, black opens the window. */}
            <rect width={CARD_W} height={CARD_H} fill="#fff" />
            <path d={merged} fill="#000" fillRule="evenodd" />
          </mask>
        </defs>
        <rect width={CARD_W} height={CARD_H} className="cutout-fill" mask={`url(#${maskId})`} />
        {/* No rim on the window: the path is one subpath per piece, so stroking
            it draws every internal boundary too, not just the silhouette. The
            card colour meeting the live video is edge enough. The 5 card is the
            exception — its piece divisions are the whole point, so they are
            drawn over the window as they are on the printed card. */}
        {showSeams
          ? paths.map((d, i) => <path key={i} d={d} className="cutout-seam" />)
          : null}
      </svg>
    );
  }

  return (
    <svg viewBox={`0 0 ${CARD_W} ${CARD_H}`} className={`model${showSeams ? ' seams' : ''}`}>
      {showSeams ? (
        // Seams are the point on a 5 card, so each piece is drawn separately
        // and outlined in the card colour.
        paths.map((d, i) => <path key={i} d={d} />)
      ) : (
        // One path, one fill. Drawing each piece separately leaves a hairline
        // of card colour along every shared edge, where neither shape's
        // anti-aliased pixels quite cover it.
        <path d={merged} />
      )}
    </svg>
  );
}

/**
 * The gold pips printed under the numeral — LEGO studs seen from above, so a
 * disc with a smaller raised disc on top.
 */
export function StudPips({ count }: { count: number }) {
  const perRow = count > 6 ? 4 : 3;
  const rows: number[][] = [];
  for (let i = 0; i < count; i += perRow) {
    rows.push(Array.from({ length: Math.min(perRow, count - i) }, (_, k) => i + k));
  }

  return (
    <div className="pips">
      {rows.map((row, i) => (
        <div key={i} className="pip-row">
          {row.map((n) => (
            <span key={n} className="pip" />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * A face-down pile.
 *
 * You pick without seeing the model, so the number is the whole decision: how
 * many pieces you take on for that many points. The stack behind is the rest of
 * the pile — what makes taking one read as taking the top card off a deck.
 *
 * Turning the card over is not done here: it happens in the flight layer, which
 * can carry the card across to where it lands on the stage. See DealTransition.
 */
export function CountCard({
  count,
  onPick,
  disabled,
  arrive,
  delay = 0,
}: {
  count: number;
  onPick: (event: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  /** Coming back onto the table, by the edge it is nearer to. */
  arrive?: 'left' | 'right';
  /** Staggered, so the row deals itself back out rather than landing at once. */
  delay?: number;
}) {
  return (
    <div
      className={`deck tier-${count}${arrive ? ` arriving exit-${arrive}` : ''}`}
      data-count={count}
      style={arrive ? ({ '--in-delay': `${delay}ms` } as never) : undefined}
    >
      <button className="count-card" onClick={onPick} disabled={disabled}>
        <span className="face front">
          <span className="numeral">{count}</span>
          <StudPips count={count} />
        </span>
      </button>
    </div>
  );
}

/**
 * The pile the current card came off, still on the table beside it.
 *
 * Face down and still stacked: the card in play left this behind, and showing
 * it is what makes the drawn card read as one card out of a pile rather than
 * as the only card there is.
 */
export function DeckStack({ count, ref }: { count: number; ref?: Ref<HTMLDivElement> }) {
  return (
    <div className={`deck stage-deck tier-${count}`} ref={ref} aria-hidden="true">
      <span className="face front">
        <span className="numeral">{count}</span>
        <StudPips count={count} />
      </span>
    </div>
  );
}
